import os

try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))  # project-root .env.local

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import admin_auth, interview, employee, employee_auth

app = FastAPI(title="AI-Interview Backend")

frontend_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_auth.router)
app.include_router(interview.router)
app.include_router(employee.router)
app.include_router(employee_auth.router)


@app.get("/health")
def health():
    return {"status": "ok"}
