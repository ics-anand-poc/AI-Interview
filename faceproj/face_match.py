import cv2
import numpy as np
import os
import torch
import mediapipe as mp

from PIL import Image
from facenet_pytorch import (
    MTCNN,
    InceptionResnetV1
)

# =====================================
# CONFIG
# =====================================

TOLERANCE = 0.8
LOOK_DOWN_THRESHOLD = 0.28

# =====================================
# MEDIAPIPE
# =====================================

mp_face_mesh = mp.solutions.face_mesh

face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=False,
    max_num_faces=5,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

# =====================================
# FACE COMPARISON
# =====================================

def compare_faces(
    current_encoding,
    reference_encoding,
    tolerance=TOLERANCE
):
    distance = np.linalg.norm(
        current_encoding - reference_encoding
    )

    return distance < tolerance


# =====================================
# LOOKING DOWN DETECTION
# =====================================

def is_looking_down(frame):

    try:

        rgb = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2RGB
        )

        results = face_mesh.process(rgb)

        if not results.multi_face_landmarks:
            return False

        landmarks = (
            results
            .multi_face_landmarks[0]
            .landmark
        )

        nose = landmarks[1]
        chin = landmarks[152]

        distance = chin.y - nose.y

        print(
            "Nose-Chin Distance:",
            round(distance, 3)
        )

        return distance < LOOK_DOWN_THRESHOLD

    except Exception as e:

        print(
            "Look Down Error:",
            e
        )

        return False


# =====================================
# MAIN
# =====================================

def main():

    device = torch.device(
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )

    print(
        "Using device:",
        device
    )

    # ---------------------------------

    mtcnn = MTCNN(
        image_size=160,
        keep_all=True,
        device=device
    )

    resnet = (
        InceptionResnetV1(
            pretrained="vggface2"
        )
        .eval()
        .to(device)
    )

    # ---------------------------------
    # REFERENCE IMAGE
    # ---------------------------------

    reference_path = os.path.join(
        os.path.dirname(__file__),
        "aryan.jpg"
    )

    if not os.path.exists(
        reference_path
    ):
        print(
            "Reference image missing"
        )
        return

    reference_img = (
        Image.open(reference_path)
        .convert("RGB")
    )

    reference_face = mtcnn(
        reference_img
    )

    if reference_face is None:

        print(
            "No face found in reference image"
        )

        return

    if len(reference_face.shape) == 4:
        reference_face = reference_face[0]

    with torch.no_grad():

        reference_encoding = (
            resnet(
                reference_face
                .unsqueeze(0)
                .to(device)
            )
            .cpu()
            .numpy()[0]
        )

    print(
        "Reference loaded."
    )

    # ---------------------------------
    # CAMERA
    # ---------------------------------

    cap = cv2.VideoCapture(0)

    cap.set(
        cv2.CAP_PROP_FRAME_WIDTH,
        1280
    )

    cap.set(
        cv2.CAP_PROP_FRAME_HEIGHT,
        720
    )

    if not cap.isOpened():

        print(
            "Cannot open webcam"
        )

        return

    critical_flags = 0

    while True:

        ret, frame = cap.read()

        if not ret:
            continue

        # IMPORTANT:
        # DO NOT FLIP THE FRAME
        # This keeps left = left
        # right = right

        rgb = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2RGB
        )

        status = "UNKNOWN"

        boxes, probs = mtcnn.detect(
            Image.fromarray(rgb)
        )

        face_count = 0

        if boxes is not None:

            for prob in probs:

                if prob > 0.90:
                    face_count += 1

        # ---------------------------------
        # DRAW BOXES
        # ---------------------------------

        if boxes is not None:

            for box in boxes:

                x1, y1, x2, y2 = map(
                    int,
                    box
                )

                cv2.rectangle(
                    frame,
                    (x1, y1),
                    (x2, y2),
                    (0, 255, 0),
                    2
                )

        print(
            "Faces:",
            face_count
        )

        # ---------------------------------
        # NO FACE
        # ---------------------------------

        if face_count == 0:

            status = (
                "NO FACE DETECTED"
            )

            critical_flags += 1

        # ---------------------------------
        # MULTIPLE PERSONS
        # ---------------------------------

        elif face_count > 1:

            status = (
                "MULTIPLE PERSONS DETECTED"
            )

            critical_flags += 1

        # ---------------------------------
        # LOOKING DOWN
        # ---------------------------------

        elif is_looking_down(frame):

            status = (
                "LOOKING DOWN"
            )

            critical_flags += 1

        # ---------------------------------
        # FACE RECOGNITION
        # ---------------------------------

        else:

            try:

                detected_face = mtcnn(
                    Image.fromarray(rgb)
                )

                if detected_face is not None:

                    if len(
                        detected_face.shape
                    ) == 4:
                        detected_face = (
                            detected_face[0]
                        )

                    with torch.no_grad():

                        current_encoding = (
                            resnet(
                                detected_face
                                .unsqueeze(0)
                                .to(device)
                            )
                            .cpu()
                            .numpy()[0]
                        )

                    if compare_faces(
                        current_encoding,
                        reference_encoding
                    ):

                        status = (
                            "MATCH FOUND"
                        )

                    else:

                        status = (
                            "NO MATCH"
                        )

                else:

                    status = (
                        "NO FACE"
                    )

            except Exception as e:

                print(
                    "Recognition Error:",
                    e
                )

                status = "ERROR"

        # ---------------------------------
        # STATUS COLOR
        # ---------------------------------

        color = (
            (0, 255, 0)
            if status == "MATCH FOUND"
            else (0, 0, 255)
        )

        cv2.putText(
            frame,
            status,
            (20, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            color,
            3
        )

        cv2.putText(
            frame,
            f"FLAGS: {critical_flags}",
            (20, 100),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (0, 0, 255),
            2
        )

        cv2.imshow(
            "AI Interview Monitoring",
            frame
        )

        key = cv2.waitKey(1)

        if key & 0xFF == ord("q"):
            break

    cap.release()

    cv2.destroyAllWindows()

    face_mesh.close()


if __name__ == "__main__":
    main()