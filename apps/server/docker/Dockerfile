# Built from the repository root:
#   docker build -f apps/server/docker/Dockerfile -t foxfire-server .
#
# The context is the repo root rather than this directory, because the build
# needs the whole apps/server tree — and the web client, from apps/web and
# packages/ — and a Dockerfile cannot reach above its own context.
# docker-compose.yml sets that up.

# The web client this server hosts. Built here rather than copied in, so the
# image carries the web client of this commit and not whatever a machine last
# built; and built from the repository's own lockfile, so it carries exactly
# the packages CI tested.
#
# Debian rather than Alpine: the lockfile's native packages — esbuild, Rollup —
# are the glibc builds, and npm ci installs what the lockfile says.
FROM node:24-bookworm-slim AS web
WORKDIR /src

# Every workspace's package.json, not just the web client's: npm ci checks the
# lockfile against all of them, so one missing here fails the install rather
# than being skipped. A new workspace is exactly the change least likely to be
# tested against this file.
COPY package.json package-lock.json ./
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/screens/package.json ./packages/screens/
COPY packages/ui/package.json ./packages/ui/

# Only the web client's dependencies, and no install scripts: Electron's would
# otherwise download a hundred megabytes of desktop app to build a web page.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --workspace @foxfire/web --include-workspace-root=false --ignore-scripts

COPY tsconfig.base.json ./
COPY tooling/ ./tooling/
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
RUN npm run build -w @foxfire/web

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Project files first, restored on their own. This layer is keyed only on the
# csproj files, so editing code does not re-download every package — which on a
# homelab's upload is the difference between a fast rebuild and a coffee.
#
# Every project has to be listed. Restore follows project references, so one
# missing from here fails the restore rather than merely slowing it — and a new
# project is exactly the change least likely to be tested against this file.
COPY apps/server/Directory.Build.props apps/server/global.json ./apps/server/
COPY apps/server/Foxfire.Server.slnx ./apps/server/
COPY apps/server/src/Foxfire.Api/Foxfire.Api.csproj ./apps/server/src/Foxfire.Api/
COPY apps/server/src/Foxfire.Core/Foxfire.Core.csproj ./apps/server/src/Foxfire.Core/
COPY apps/server/src/Foxfire.Data/Foxfire.Data.csproj ./apps/server/src/Foxfire.Data/
COPY apps/server/src/Foxfire.Riot/Foxfire.Riot.csproj ./apps/server/src/Foxfire.Riot/
COPY apps/server/src/Foxfire.Storage/Foxfire.Storage.csproj ./apps/server/src/Foxfire.Storage/
RUN dotnet restore apps/server/src/Foxfire.Api/Foxfire.Api.csproj

COPY apps/server/ ./apps/server/

# Into wwwroot, which publish carries into the output beside the server —
# where Web/SpaHosting.cs looks for it.
COPY --from=web /src/apps/web/dist ./apps/server/src/Foxfire.Api/wwwroot

RUN dotnet publish apps/server/src/Foxfire.Api/Foxfire.Api.csproj \
      --no-restore \
      --configuration Release \
      --output /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Not root. Nothing here writes to disk — the database is SQL Server's problem
# and replays are the blob store's — so there is nothing for a writable
# filesystem to be for.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin foxfire
USER 10001

COPY --from=build /app .

# Plain HTTP inside the container. TLS is the reverse proxy's job: a
# self-hoster needs Caddy or nginx in front of this anyway to get a certificate,
# and terminating twice would mean managing certificates in two places.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "Foxfire.Api.dll"]
