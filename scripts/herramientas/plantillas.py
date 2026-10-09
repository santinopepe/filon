#!/usr/bin/env python3
"""Agrega/reemplaza por id; recibe un archivo JSON con una lista de plantillas."""
import json
import sys
from pathlib import Path
ruta = Path(__file__).resolve().parents[2] / 'datos/plantillas.json'
d = json.loads(ruta.read_text())
nuevas = json.loads(Path(sys.argv[1]).read_text())
if isinstance(nuevas, dict):
    nuevas = nuevas.get('plantillas', [nuevas])
for p in nuevas:
    indice = next((i for i, vieja in enumerate(d['plantillas']) if vieja['id'] == p['id']), None)
    if indice is None:
        d['plantillas'].append(p)
    else:
        d['plantillas'][indice] = p
ruta.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
