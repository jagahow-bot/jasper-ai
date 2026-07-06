from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.job_history import warmup_history_index
from app.notifications import notifications_configured
from app.routers import jobs, lab_objective_switch, scenarios, universe


@asynccontextmanager
async def lifespan(_app: FastAPI):
    warmup_history_index()
    yield


app = FastAPI(
    title="JASPER.AI API",
    version="0.1.0",
    description="數學引擎算數字，LLM 只寫敘事。",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.api_cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenarios.router)
app.include_router(universe.router)
app.include_router(jobs.router)
app.include_router(lab_objective_switch.router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "0.1.0",
        "email_notifications": (
            "configured" if notifications_configured() else "disabled"
        ),
    }
