import json
import os
from datetime import datetime, date
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import (
    create_engine, Column, Integer, String, Date, DateTime, ForeignKey, UniqueConstraint, func
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

TZ = ZoneInfo(os.getenv("APP_TZ", "Europe/Berlin"))
DATA_DIR = os.getenv("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "app.db")
TASKS_PATH = os.path.join(DATA_DIR, "tasks.json")

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    technical_name = Column(String, unique=True, nullable=False)
    tile_text = Column(String, nullable=False)
    success_text = Column(String, nullable=False)
    deadline = Column(Date, nullable=False)
    goal = Column(Integer, nullable=False)

    checkins = relationship("Checkin", back_populates="task")

class Checkin(Base):
    __tablename__ = "checkins"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    day = Column(Date, nullable=False)
    answer = Column(String, nullable=False)  # "yes" | "no"
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(TZ))

    task = relationship("Task", back_populates="checkins")
    __table_args__ = (UniqueConstraint("task_id", "day", name="uq_task_day"),)

Base.metadata.create_all(engine)

def ensure_tasks_file():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(TASKS_PATH):
        sample = [
            {
                "id": 1,
                "technical_name": "swimming",
                "tile_text": "Schwimmen gewesen?",
                "success_text": "§current von $goal erreicht. Zu erledigen bis $deadline",
                "deadline": f"{date.today().year}-12-31",
                "goal": 26
            }
        ]
        with open(TASKS_PATH, "w", encoding="utf-8") as f:
            json.dump(sample, f, ensure_ascii=False, indent=2)

def upsert_tasks_from_json():
    ensure_tasks_file()
    with open(TASKS_PATH, "r", encoding="utf-8") as f:
        tasks = json.load(f)

    db = SessionLocal()
    try:
        for t in tasks:
            dl = date.fromisoformat(t["deadline"])
            existing = db.query(Task).filter(Task.technical_name == t["technical_name"]).one_or_none()
            if existing:
                existing.tile_text = t["tile_text"]
                existing.success_text = t["success_text"]
                existing.deadline = dl
                existing.goal = int(t["goal"])
            else:
                db.add(Task(
                    id=int(t["id"]),
                    technical_name=t["technical_name"],
                    tile_text=t["tile_text"],
                    success_text=t["success_text"],
                    deadline=dl,
                    goal=int(t["goal"])
                ))
        db.commit()
    finally:
        db.close()

def today_berlin() -> date:
    return datetime.now(TZ).date()

def render_template(text: str, current: int, goal: int, deadline: date) -> str:
    # unterstützt deine Platzhalter-Notation
    out = text
    out = out.replace("§current", str(current))
    out = out.replace("$goal", str(goal))
    out = out.replace("$deadline", deadline.isoformat())
    return out

app = FastAPI()
upsert_tasks_from_json()

app.mount("/static", StaticFiles(directory="static"), name="static")

class ConfirmBody(BaseModel):
    answer: str  # "yes" | "no"

@app.get("/")
def index():
    return FileResponse("static/index.html")

@app.get("/api/tasks")
def get_tasks():
    db = SessionLocal()
    try:
        td = today_berlin()
        tasks = db.query(Task).order_by(Task.id.asc()).all()
        result = []

        for t in tasks:
            # "Jahresziel": Zählung im Jahr der Deadline (typisch 01.01..deadline)
            start = date(t.deadline.year, 1, 1)

            current = db.query(func.count(Checkin.id)).filter(
                Checkin.task_id == t.id,
                Checkin.answer == "yes",
                Checkin.day >= start,
                Checkin.day <= t.deadline
            ).scalar() or 0

            todays = db.query(Checkin).filter(Checkin.task_id == t.id, Checkin.day == td).one_or_none()
            done_today = bool(todays and todays.answer == "yes")

            success_rendered = render_template(t.success_text, current=current, goal=t.goal, deadline=t.deadline)

            result.append({
                "id": t.id,
                "technical_name": t.technical_name,
                "tile_text": t.tile_text,
                "success_text": t.success_text,
                "deadline": t.deadline.isoformat(),
                "goal": t.goal,
                "current": current,
                "done_today": done_today,
                "success_rendered": success_rendered,
            })

        return {"today": td.isoformat(), "tasks": result}
    finally:
        db.close()

@app.post("/api/tasks/{task_id}/confirm")
def confirm(task_id: int, body: ConfirmBody):
    answer = body.answer.strip().lower()
    if answer not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="answer must be 'yes' or 'no'")

    db = SessionLocal()
    try:
        t = db.query(Task).filter(Task.id == task_id).one_or_none()
        if not t:
            raise HTTPException(status_code=404, detail="task not found")

        td = today_berlin()
        existing = db.query(Checkin).filter(Checkin.task_id == task_id, Checkin.day == td).one_or_none()

        # wenn heute schon "yes", dann nicht überschreiben
        if existing and existing.answer == "yes":
            return {"ok": True, "already_yes": True}

        if existing:
            existing.answer = answer
            existing.created_at = datetime.now(TZ)
        else:
            db.add(Checkin(task_id=task_id, day=td, answer=answer))

        db.commit()
        return {"ok": True}
    finally:
        db.close()
