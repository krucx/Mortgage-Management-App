# PowerShell and Pester on Debian, to run windows/tests on a Mac or Linux machine without
# installing PowerShell there. Build and run from the repo root:
#
#   docker build -t mm-pester -f docs/onboarding/013-testing/scripts/pester.Dockerfile .
#   docker run --rm -v "$PWD:/repo:ro" -w /repo mm-pester pwsh -NoProfile -c 'Invoke-Pester windows/tests'
#
# On an Intel/AMD machine, change linux-arm64 to linux-x64 below.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libicu72 \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/pwsh \
    && curl -fsSL https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/powershell-7.4.6-linux-arm64.tar.gz \
       | tar -xz -C /opt/pwsh \
    && chmod +x /opt/pwsh/pwsh && ln -s /opt/pwsh/pwsh /usr/local/bin/pwsh
RUN pwsh -NoProfile -c "Set-PSRepository PSGallery -InstallationPolicy Trusted; Install-Module Pester -MinimumVersion 5.5 -Force -Scope AllUsers"
