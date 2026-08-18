FROM python:3.12-slim

RUN useradd --create-home --uid 10001 trainer
WORKDIR /app

# requirements ก่อน train.py — แก้โค้ดแล้ว pip layer ยัง cache อยู่
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY train.py /app/train.py

ENV HOME=/scratch \
    MPLCONFIGDIR=/scratch/.mpl \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER trainer
ENTRYPOINT ["python", "./train.py"]