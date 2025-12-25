#!/bin/bash
if [ ! -f education.db ] || [ ! -s education.db ]; then
  echo "Downloading DB..."
  pip install gdown --break-system-packages -q
  python3 -m gdown https://drive.google.com/uc?id=1fzzDJ2SflVZQaOD48USxgn_GeWKszBG1 -O education.db
fi
python backend_v53.py
