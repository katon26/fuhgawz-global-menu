#!/usr/bin/env bash
# ==============================================================================
# FUHGAWZ Global Menu - Release Packaging & Validation Script
# Builds the production extension ZIP for GitHub Releases & extensions.gnome.org
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build"
UUID="fuhgawzglbmenu@katon26.github.io"
ZIP_NAME="${UUID}.shell-extension.zip"

echo "==> Validating environment..."
command -v gnome-extensions >/dev/null 2>&1 || { echo "ERROR: gnome-extensions CLI not found. Install gnome-shell."; exit 1; }
command -v glib-compile-schemas >/dev/null 2>&1 || { echo "ERROR: glib-compile-schemas not found. Install libglib2.0-bin."; exit 1; }
command -v gjs >/dev/null 2>&1 || { echo "ERROR: gjs not found."; exit 1; }

echo "==> Running automated test suite..."
gjs -m "${ROOT_DIR}/tests/test_profileManager.js"
gjs -m "${ROOT_DIR}/tests/test_hoverSubMenu_logic.js"
gjs -m "${ROOT_DIR}/tests/test_buttonPool_logic.js"
gjs -m "${ROOT_DIR}/tests/test_virtualKeyboard.js"
gjs -m "${ROOT_DIR}/tests/test_atspiScanner.js"
gjs -m "${ROOT_DIR}/tests/test_taskManager.js"
gjs -m "${ROOT_DIR}/tests/test_taskProgressBar_logic.js"
gjs -m "${ROOT_DIR}/tests/test_taskIndicator_logic.js"
gjs -m "${ROOT_DIR}/tests/test_taskIndicator_schema.js"
gjs -m "${ROOT_DIR}/tests/test_mediaManager.js"
gjs -m "${ROOT_DIR}/tests/test_mediaFloatingCard.js"
gjs -m "${ROOT_DIR}/tests/test_extension_task_integration.js"
echo "==> All tests passed!"

echo "==> Compiling GSettings schemas..."
glib-compile-schemas "${ROOT_DIR}/schemas/"

echo "==> Packaging extension bundle..."
mkdir -p "${BUILD_DIR}"
gnome-extensions pack \
  --extra-source=src/ \
  --extra-source=profiles/ \
  --extra-source=icons/ \
  --extra-source=app/ \
  --extra-source=prefs.css \
  --extra-source=stylesheet.css \
  --extra-source=schemas/ \
  --out-dir="${BUILD_DIR}" \
  --force

echo "==> Generating SHA-256 checksum..."
(cd "${BUILD_DIR}" && sha256sum "${ZIP_NAME}" > "${ZIP_NAME}.sha256")

echo "=============================================================================="
echo " Packaging Successful!"
echo " Output Archive:  ${BUILD_DIR}/${ZIP_NAME}"
echo " SHA-256 Hash:    $(cat "${BUILD_DIR}/${ZIP_NAME}.sha256")"
echo " Archive Size:    $(du -h "${BUILD_DIR}/${ZIP_NAME}" | cut -f1)"
echo "=============================================================================="
