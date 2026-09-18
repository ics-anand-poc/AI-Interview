import os

import cv2
import numpy as np
import torch
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1, fixed_image_standardization
from ultralytics import YOLO

DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
FACE_SIZE = 160
MATCH_TOLERANCE = 0.85
YOLO_WEIGHTS = os.environ.get("YOLO_WEIGHTS", "yolo11n.pt")
YOLO_CONF_THRESHOLD = float(os.environ.get("YOLO_CONF_THRESHOLD", "0.35"))
YOLO_PERSON_CLASS = 0
YOLO_PHONE_CLASS = 67

_REFERENCE_LANDMARKS_112 = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


class FacePipeline:
    def __init__(self):
        self.mtcnn = MTCNN(keep_all=True, device=DEVICE)
        self.resnet = InceptionResnetV1(pretrained="vggface2").eval().to(DEVICE)
        self.yolo = YOLO(YOLO_WEIGHTS)

    def _best_face(self, image_rgb):
        pil_image = Image.fromarray(image_rgb)
        boxes, probs, landmarks = self.mtcnn.detect(pil_image, landmarks=True)
        if boxes is None or len(boxes) == 0:
            return None
        best_index = int(np.argmax(probs))
        return boxes[best_index], probs[best_index], landmarks[best_index]

    def _align_face(self, image_rgb, landmarks, size=FACE_SIZE):
        reference = _REFERENCE_LANDMARKS_112 * (size / 112.0)
        transform, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32), reference, method=cv2.LMEDS
        )
        if transform is None:
            return None
        return cv2.warpAffine(image_rgb, transform, (size, size), borderValue=0)

    def face_embedding(self, image_rgb):
        detection = self._best_face(image_rgb)
        if detection is None:
            return None
        _, _, landmarks = detection
        aligned = self._align_face(image_rgb, landmarks)
        if aligned is None:
            return None
        tensor = torch.tensor(aligned, dtype=torch.float32).permute(2, 0, 1)
        tensor = fixed_image_standardization(tensor)
        with torch.no_grad():
            embedding = self.resnet(tensor.unsqueeze(0).to(DEVICE)).cpu().numpy()[0]
        return embedding

    def compare(self, id_image_rgb, selfie_image_rgb):
        id_embedding = self.face_embedding(id_image_rgb)
        if id_embedding is None:
            return {
                "matched": False,
                "confidence": 0,
                "reason": "Could not detect a clear face in the Government ID image. Please ensure the card is well-lit and not blurry.",
            }

        selfie_embedding = self.face_embedding(selfie_image_rgb)
        if selfie_embedding is None:
            return {
                "matched": False,
                "confidence": 0,
                "reason": "Could not detect a clear face in the captured selfie. Please look straight at the camera in a well-lit area.",
            }

        distance = float(np.linalg.norm(id_embedding - selfie_embedding))
        matched = distance < MATCH_TOLERANCE

        if matched:
            confidence = int(70 + (1.0 - (distance / MATCH_TOLERANCE)) * 30)
        else:
            confidence = int(max(0, 69 - ((distance - MATCH_TOLERANCE) / 0.75) * 69))

        reason = (
            f"Biometric comparison complete. Face distance is {distance:.4f}, "
            f"which is {'under' if matched else 'above'} the matching threshold of {MATCH_TOLERANCE}."
        )
        return {"matched": matched, "confidence": confidence, "reason": reason}

    def _gaze_state(self, image_rgb, box):
        x1, y1, x2, y2 = [max(int(v), 0) for v in box]
        crop = image_rgb[y1:y2, x1:x2]
        if crop.size == 0:
            return "one"

        detection = self._best_face(crop)
        if detection is None:
            return "one"

        _, _, landmarks = detection
        left_eye, right_eye, nose, left_mouth, right_mouth = landmarks
        horizontal_ratio = (nose[0] - left_eye[0]) / ((right_eye[0] - nose[0]) or 1)
        eye_y = (left_eye[1] + right_eye[1]) / 2
        mouth_y = (left_mouth[1] + right_mouth[1]) / 2
        vertical_ratio = (nose[1] - eye_y) / ((mouth_y - nose[1]) or 1)

        if horizontal_ratio < 0.72:
            return "right"
        if horizontal_ratio > 1.32:
            return "left"
        if vertical_ratio < 0.42:
            return "up"
        if vertical_ratio > 0.88:
            return "down"
        return "one"

    def monitor(self, image_rgb):
        result = self.yolo.predict(image_rgb, verbose=False, conf=YOLO_CONF_THRESHOLD)[0]
        has_boxes = result.boxes is not None and len(result.boxes) > 0
        classes = result.boxes.cls.cpu().numpy().astype(int) if has_boxes else np.array([])
        boxes = result.boxes.xyxy.cpu().numpy() if has_boxes else np.array([])

        person_boxes = boxes[classes == YOLO_PERSON_CLASS]
        phone_detected = bool(np.any(classes == YOLO_PHONE_CLASS))

        if len(person_boxes) == 0:
            state = "none"
        elif len(person_boxes) > 1:
            state = "multiple"
        elif phone_detected:
            state = "phone"
        else:
            state = self._gaze_state(image_rgb, person_boxes[0])

        return {
            "state": state,
            "personCount": int(len(person_boxes)),
            "phoneDetected": phone_detected,
        }


_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = FacePipeline()
    return _pipeline
