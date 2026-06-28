FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY domains ./domains
COPY startMLFlow.sh ./startMLFlow.sh

WORKDIR /app/domains/iris

CMD ["python", "train_and_register.py", "--step", "all"]
