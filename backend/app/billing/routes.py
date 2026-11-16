from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import billing
from app.auth.deps import CurrentUser, current_user
from app.db import get_db

router = APIRouter(prefix="/api/billing", tags=["billing"])


class PackageIn(BaseModel):
    package: str = Field(min_length=1, max_length=40)


@router.get("/packages")
def packages(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    return billing.packages(db)


@router.post("/interest", status_code=201)
def interest(body: PackageIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    billing.register_interest(db, user.id, body.package)
    return {"ok": True}


@router.post("/checkout")
def checkout(body: PackageIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    return billing.checkout(db, user.id, body.package)
