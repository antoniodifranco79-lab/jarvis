FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 JARVIS_HOST=0.0.0.0 JARVIS_PORT=8765
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY jarvis ./jarvis
RUN pip install --no-cache-dir ".[server]"
VOLUME ["/root/.jarvis", "/root/jarvis-workspace"]
EXPOSE 8765
CMD ["jarvis", "serve"]
