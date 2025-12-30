import json
import os
from datetime import datetime, date
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import (
    create_engine, Column, Integer, String, Date, DateTime, ForeignKey, UniqueConstraint,
    func, Float, text
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

TZ = ZoneInfo(os.getenv("APP_TZ", "Europe/Berlin"))

DATA_DIR = os.getenv("DATA_DIR", "/data")
TASKS_PATH = os.getenv("TASKS_PATH", "/config/tasks.json")

# DB URL precedence: SQLALCHEMY_DATABASE_URL > DATABASE_URL > default
DEFAULT_DB_URL = f"sqlite:////{DATA_DIR.strip('/')}/processtracker.db"
DB_URL = (
    os.getenv("SQLALCHEMY_DATABASE_URL")
    or os.getenv("DATABASE_URL")
    or DEFAULT_DB_URL
)

connect_args = {}
if DB_URL.startswith("sqlite:"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DB_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


# -------------------- Models --------------------
class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    technical_name = Column(String, unique=True, nullable=False)

    tile_text = Column(String, nullable=False)
    success_text = Column(String, nullable=False)
    deadline = Column(Date, nullable=False)

    # goal:
    # - confirm: yearly target count
    # - number_diff: target value (e.g., target weight)
    goal = Column(Float, nullable=False)

    task_type = Column(String, nullable=False, default="confirm")  # "confirm" | "number_diff"
    startvalue = Column(Float, nullable=True)  # for number_diff

    checkins = relationship("Checkin", back_populates="task")
    number_entries = relationship("NumberEntry", back_populates="task")


class Checkin(Base):
    __tablename__ = "checkins"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    day = Column(Date, nullable=False)
    answer = Column(String, nullable=False)  # "yes" | "no"
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(TZ))

    task = relationship("Task", back_populates="checkins")
    __table_args__ = (UniqueConstraint("task_id", "day", name="uq_task_day"),)


class NumberEntry(Base):
    __tablename__ = "number_entries"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    day = Column(Date, nullable=False)
    value = Column(Float, nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(TZ))

    task = relationship("Task", back_populates="number_entries")
    __table_args__ = (UniqueConstraint("task_id", "day", name="uq_number_task_day"),)


# -------------------- Helpers --------------------
def today_berlin() -> date:
    return datetime.now(TZ).date()

def fmt_goal(goal: float) -> str:
    if abs(goal - round(goal)) < 1e-9:
        return str(int(round(goal)))
    return f"{goal:g}"

def normalize_success_text(s: str) -> str:
    # support old "<br>" formatting safely by converting to newlines
    return (s or "").replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")

def render_template(text_: str, current: int, goal: float, deadline_: date) -> str:
    out = normalize_success_text(text_)
    out = out.replace("§current", str(current))
    out = out.replace("$goal", fmt_goal(goal))
    out = out.replace("$deadline", deadline_.isoformat())
    return out

def _has_column(conn, table: str, col: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == col for r in rows)

def migrate_sqlite():
    # create what exists
    Base.metadata.create_all(engine)

    # SQLite: add missing columns for older DBs
    if DB_URL.startswith("sqlite:"):
        with engine.begin() as conn:
            if not _has_column(conn, "tasks", "task_type"):
                conn.execute(text("ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'confirm'"))
            if not _has_column(conn, "tasks", "startvalue"):
                conn.execute(text("ALTER TABLE tasks ADD COLUMN startvalue REAL"))

    Base.metadata.create_all(engine)

def load_tasks_from_json() -> list[dict]:
    if not os.path.exists(TASKS_PATH):
        raise RuntimeError(f"tasks.json not found at {TASKS_PATH}")
    with open(TASKS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("tasks.json must be a JSON array of tasks")
    return data

def upsert_tasks():
    tasks = load_tasks_from_json()
    db = SessionLocal()
    try:
        for t in tasks:
            technical_name = t["technical_name"]
            task_type = (t.get("task_type") or "confirm").strip().lower()

            # allow earlier naming
            tile_text = t.get("tile_text") or t.get("title_text")
            success_text = t.get("success_text") or t.get("sucess_text") or ""
            success_text = normalize_success_text(success_text)

            if not tile_text:
                raise ValueError(f"Task '{technical_name}' missing tile_text/title_text")

            deadline = date.fromisoformat(t["deadline"])
            goal = float(t["goal"])

            startvalue = t.get("startvalue", None)
            startvalue = float(startvalue) if startvalue is not None else None

            if task_type == "number_diff":
                if startvalue is None:
                    raise ValueError(f"Task '{technical_name}' (number_diff) requires startvalue")

            existing = db.query(Task).filter(Task.technical_name == technical_name).one_or_none()
            if existing:
                existing.tile_text = tile_text
                existing.success_text = success_text
                existing.deadline = deadline
                existing.goal = goal
                existing.task_type = task_type
                existing.startvalue = startvalue
            else:
                db.add(Task(
                    id=int(t["id"]),
                    technical_name=technical_name,
                    tile_text=tile_text,
                    success_text=success_text,
                    deadline=deadline,
                    goal=goal,
                    task_type=task_type,
                    startvalue=startvalue
                ))

        db.commit()
    finally:
        db.close()


# -------------------- App --------------------
app = FastAPI()
migrate_sqlite()
upsert_tasks()

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def index():
    return FileResponse("static/index.html")


class ConfirmBody(BaseModel):
    answer: str  # yes/no

class ValueBody(BaseModel):
    value: float = Field(..., ge=-100000, le=100000)


@app.get("/api/tasks")
def get_tasks():
    db = SessionLocal()
    try:
        td = today_berlin()
        tasks = db.query(Task).order_by(Task.id.asc()).all()
        result = []

        for t in tasks:
            if t.task_type == "number_diff":
                latest_entry = db.query(NumberEntry).filter(
                    NumberEntry.task_id == t.id
                ).order_by(NumberEntry.day.desc()).first()

                latest_value = latest_entry.value if latest_entry else None
                latest_day = latest_entry.day.isoformat() if latest_entry else None

                entry_today = db.query(NumberEntry).filter(
                    NumberEntry.task_id == t.id,
                    NumberEntry.day == td
                ).one_or_none()
                done_today = entry_today is not None

                achieved = bool(latest_value is not None and latest_value <= t.goal)

                # 1) Start - Current
                start_minus_current = None
                start_minus_current_class = None

                # 2) Current - Ziel
                current_minus_goal = None
                current_minus_goal_class = None

                if latest_value is not None and t.startvalue is not None:
                    start_minus_current = t.startvalue - latest_value
                    # positive => good (lost relative to start)
                    if start_minus_current > 0:
                        start_minus_current_class = "good"
                    elif start_minus_current < 0:
                        start_minus_current_class = "bad"
                    else:
                        start_minus_current_class = "neutral"

                    current_minus_goal = latest_value - t.goal
                    # <= 0 => good (at/below goal)
                    if current_minus_goal <= 0:
                        current_minus_goal_class = "good"
                    else:
                        current_minus_goal_class = "bad"

                result.append({
                    "id": t.id,
                    "technical_name": t.technical_name,
                    "task_type": t.task_type,
                    "tile_text": t.tile_text,
                    "deadline": t.deadline.isoformat(),
                    "goal": t.goal,
                    "startvalue": t.startvalue,

                    "latest_day": latest_day,
                    "latest_value": latest_value,

                    "done_today": done_today,
                    "achieved": achieved,

                    "start_minus_current": start_minus_current,
                    "start_minus_current_class": start_minus_current_class,
                    "current_minus_goal": current_minus_goal,
                    "current_minus_goal_class": current_minus_goal_class,
                })
                continue

            # confirm task counting (current year -> fixes "0/26" when deadline is next year)
            start = date(td.year, 1, 1)

            current = db.query(func.count(Checkin.id)).filter(
                Checkin.task_id == t.id,
                Checkin.answer == "yes",
                Checkin.day >= start,
                Checkin.day <= t.deadline
            ).scalar() or 0

            todays = db.query(Checkin).filter(
                Checkin.task_id == t.id,
                Checkin.day == td
            ).one_or_none()

            done_today = bool(todays and todays.answer == "yes")
            success_rendered = render_template(t.success_text, current=current, goal=t.goal, deadline_=t.deadline)

            result.append({
                "id": t.id,
                "technical_name": t.technical_name,
                "task_type": t.task_type,
                "tile_text": t.tile_text,
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
        if t.task_type != "confirm":
            raise HTTPException(status_code=400, detail="task is not a confirm task")

        td = today_berlin()
        existing = db.query(Checkin).filter(Checkin.task_id == task_id, Checkin.day == td).one_or_none()

        # once "yes" today -> lock for today
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


@app.post("/api/tasks/{task_id}/value")
def set_value(task_id: int, body: ValueBody):
    db = SessionLocal()
    try:
        t = db.query(Task).filter(Task.id == task_id).one_or_none()
        if not t:
            raise HTTPException(status_code=404, detail="task not found")
        if t.task_type != "number_diff":
            raise HTTPException(status_code=400, detail="task is not a number_diff task")

        # If already achieved, lock permanently
        latest_entry = db.query(NumberEntry).filter(
            NumberEntry.task_id == task_id
        ).order_by(NumberEntry.day.desc()).first()

        if latest_entry and latest_entry.value <= t.goal:
            raise HTTPException(status_code=400, detail="task already achieved")

        td = today_berlin()
        existing_today = db.query(NumberEntry).filter(
            NumberEntry.task_id == task_id,
            NumberEntry.day == td
        ).one_or_none()

        if existing_today:
            # allow overwrite same day (UI disables anyway; keeps API forgiving)
            existing_today.value = float(body.value)
            existing_today.created_at = datetime.now(TZ)
        else:
            db.add(NumberEntry(task_id=task_id, day=td, value=float(body.value)))

        db.commit()
        return {"ok": True}
    finally:
        db.close()
