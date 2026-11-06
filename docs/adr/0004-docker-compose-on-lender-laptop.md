# The app ships as a Docker Compose stack on the Lender's laptop

The app runs locally on the Lender's laptop, which could be macOS or Windows. Rather than maintain per-OS launchers and Python/Node installs, we ship a Docker Compose stack of two services:

- **frontend**: nginx serving the built React app and proxying `/api` to the backend.
- **backend**: FastAPI.

Only the frontend port is published, and only on `127.0.0.1`. The database, photos and backup destination are bind-mounted host folders set in `.env`, so the Lender's data lives on the laptop disk and never only inside a container. The cost is that the Lender must install Docker Desktop.

The images are published to Docker Hub for each release, and the Compose file pulls them, so nothing is built on the Lender's laptop; `docker-compose.dev.yml` builds them from source for development.

**Superseded in part by Documentation/adr/0013:** the stack is now one service, `app`, from one image: the backend serves the screens in Docker too, and nginx is gone. The rest stands: Docker Compose on the Lender's laptop, the port on `127.0.0.1` only, the data in bind-mounted host folders, and the image published to Docker Hub.
