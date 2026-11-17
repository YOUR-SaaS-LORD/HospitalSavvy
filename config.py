import os

from dotenv import load_dotenv

# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

load_dotenv()

# ============================================================
# DIRECTORIES
# ============================================================

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

INSTANCE_DIR = os.path.join(BASE_DIR, "instance")

UPLOAD_DIR = os.path.join(
    BASE_DIR,
    "static",
    "uploads"
)

# Create required directories automatically
os.makedirs(INSTANCE_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ============================================================
# APPLICATION CONFIGURATION
# ============================================================

class Config:

    # ========================================================
    # SECURITY
    # ========================================================

    SECRET_KEY = os.environ.get(
        "SECRET_KEY",
        "change-this-secret-key-in-production"
    )

    # ========================================================
    # POSTGRESQL DATABASE
    # ========================================================

    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL"
    )

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ========================================================
    # FILE UPLOADS
    # ========================================================

    MAX_CONTENT_LENGTH = 50 * 1024 * 1024

    UPLOAD_FOLDER = UPLOAD_DIR