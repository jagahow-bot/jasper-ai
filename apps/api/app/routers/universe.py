from fastapi import APIRouter

from app.profiles import get_universe, get_universe_meta

router = APIRouter(prefix="/universe", tags=["universe"])


@router.get("")
def list_universe():
    return {
        "meta": get_universe_meta(),
        "items": get_universe(),
    }


@router.get("/meta")
def universe_meta():
    return get_universe_meta()
