#!/bin/sh
# Banco separado para o pytest: <POSTGRES_DB>_test (as migrations rodam nele pelo conftest).
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE DATABASE \"${POSTGRES_DB}_test\""
