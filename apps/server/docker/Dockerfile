# Built from the repository root:
#   docker build -f apps/server/docker/Dockerfile -t foxfire-server .
#
# The context is the repo root rather than this directory, because the build
# needs the whole apps/server tree and a Dockerfile cannot reach above its own
# context. docker-compose.yml sets that up.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Project files first, restored on their own. This layer is keyed only on the
# csproj files, so editing code does not re-download every package — which on a
# homelab's upload is the difference between a fast rebuild and a coffee.
COPY apps/server/Directory.Build.props apps/server/global.json ./apps/server/
COPY apps/server/Foxfire.Server.slnx ./apps/server/
COPY apps/server/src/Foxfire.Api/Foxfire.Api.csproj ./apps/server/src/Foxfire.Api/
COPY apps/server/src/Foxfire.Core/Foxfire.Core.csproj ./apps/server/src/Foxfire.Core/
COPY apps/server/src/Foxfire.Data/Foxfire.Data.csproj ./apps/server/src/Foxfire.Data/
COPY apps/server/src/Foxfire.Riot/Foxfire.Riot.csproj ./apps/server/src/Foxfire.Riot/
RUN dotnet restore apps/server/src/Foxfire.Api/Foxfire.Api.csproj

COPY apps/server/ ./apps/server/
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
