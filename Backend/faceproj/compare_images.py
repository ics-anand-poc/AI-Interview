import sys
import json

import numpy as np
from PIL import Image

from pipeline import get_pipeline


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "matched": False,
            "confidence": 0,
            "reason": "Error: Missing input image arguments. Usage: python compare_images.py <id_path> <selfie_path>",
        }))
        return

    id_path, selfie_path = sys.argv[1], sys.argv[2]
    try:
        pipeline = get_pipeline()
        id_image = np.array(Image.open(id_path).convert("RGB"))
        selfie_image = np.array(Image.open(selfie_path).convert("RGB"))
        result = pipeline.compare(id_image, selfie_image)
    except Exception as e:
        result = {
            "matched": False,
            "confidence": 0,
            "reason": f"Biometric comparison execution error: {str(e)}",
        }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
