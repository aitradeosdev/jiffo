# Postgres with PostGIS for the test server (docs/deploy.md), from the official Postgres image, which is built for
# both x86-64 and ARM servers (PostGIS's own image is x86-64 only). PostGIS comes from Postgres's own package
# repository, which the image already uses. The migrations create the extension.
FROM postgres:16-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
