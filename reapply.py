#!/usr/bin/env python3
"""Reaplica modelos, effort e multiplicadores do Droid sem reiniciar o OpenMausBot."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


PATCH = Path(__file__).with_name("droid-models.patch")
FILES = ("dist-server/index.js", "dist-server/server/drivers/acp/droid.js")


def patch_files(directory, *, reverse=False, check=False):
    # --force impede a inversão automática do sentido, sem relaxar o contexto.
    command = [
        "patch", "--directory", str(directory), "--strip=1", "--force",
        "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=-",
        "--input", str(PATCH), "--reverse" if reverse else "--forward",
    ]
    if check:
        command.append("--dry-run")
    return subprocess.run(command, capture_output=True, text=True)


def replace_file(path, content):
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.droid-models-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        shutil.copymode(path, temporary)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def apply(root, check=False):
    root = Path(root).resolve()
    package = json.loads((root / "package.json").read_text())
    if package.get("name") != "openmausbot":
        raise RuntimeError("O diretório informado não é uma instalação do OpenMausBot.")
    originals = {}
    for name in FILES:
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError(f"Arquivo ausente ou estrutura incompatível: {path}")
        originals[name] = path.read_bytes()
    with tempfile.TemporaryDirectory(prefix="openmausbot-droid-models-") as work:
        work = Path(work)
        (work / "package.json").write_text('{"type":"module"}\n')
        for name, content in originals.items():
            path = work / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        already_applied = patch_files(work, reverse=True, check=True).returncode == 0
        if not already_applied and patch_files(work).returncode != 0:
            raise RuntimeError(
                "O código mudou ou o patch está parcial. Nenhum arquivo da instalação foi alterado. "
                "Confira se a nova versão já resolveu o problema; caso contrário, adapte o patch."
            )
        for name in FILES:
            result = subprocess.run(["node", "--check", str(work / name)], capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(f"node --check falhou em {name}. Instalação intacta.\n{result.stderr}")
        if already_applied:
            print(f"OpenMausBot {package.get('version', '?')}: patch já aplicado. Nada alterado.")
            return
        if check:
            print(f"OpenMausBot {package.get('version', '?')}: patch compatível; sintaxe validada. Nada alterado.")
            return
        if any((root / name).read_bytes() != content for name, content in originals.items()):
            raise RuntimeError("A instalação mudou durante a validação. Execute novamente após a atualização.")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        for name, content in originals.items():
            path = root / name
            backup = path.with_name(f"{path.name}.bak-droid-models-{stamp}")
            with backup.open("xb") as stream:
                stream.write(content)
            shutil.copystat(path, backup)
            print(f"Backup: {backup}")
        written = []
        try:
            for name in FILES:
                if (root / name).read_bytes() != originals[name]:
                    raise RuntimeError("A instalação mudou durante a aplicação.")
                replace_file(root / name, (work / name).read_bytes())
                written.append(name)
        except Exception:
            for name in reversed(written):
                if (root / name).read_bytes() == (work / name).read_bytes():
                    replace_file(root / name, originals[name])
                else:
                    print(f"Arquivo alterado externamente; restaure o backup manualmente: {root / name}")
            raise
    print(f"OpenMausBot {package.get('version', '?')}: patch aplicado e sintaxe validada nos dois arquivos.")
    print("Servidor NÃO reiniciado. Reinicie quando puder interromper as conversas e atualize os modelos do Droid.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".local/lib/node_modules/openmausbot",
                        help="diretório da instalação do OpenMausBot")
    parser.add_argument("--check", action="store_true", help="validar sem modificar a instalação")
    args = parser.parse_args()
    try:
        apply(args.root, args.check)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Erro: {error}\n")


if __name__ == "__main__":
    main()
