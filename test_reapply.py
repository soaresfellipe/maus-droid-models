"""Testa somente cópias temporárias, nunca a instalação em uso."""

import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import reapply


class ReapplyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="test-openmausbot-patch-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "package.json").write_text(json.dumps({
            "name": "openmausbot", "version": "fixture-0.1.110", "type": "module",
        }))
        for name in reapply.FILES:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(__file__).with_name("fixtures") / target.name, target)
        self.originals = self.contents()

    def contents(self):
        return {name: (self.root / name).read_bytes() for name in reapply.FILES}

    def backups(self):
        return sorted(self.root.rglob("*.bak-droid-models-*"))

    def apply(self, check=False):
        with contextlib.redirect_stdout(io.StringIO()):
            reapply.apply(self.root, check)

    def test_check_does_not_change_files_or_create_backups(self):
        self.apply(check=True)
        self.assertEqual(self.contents(), self.originals)
        self.assertEqual(self.backups(), [])

    def test_apply_creates_backups_and_is_idempotent(self):
        self.apply()
        backups = self.backups()
        self.assertEqual(len(backups), 2)
        for name, content in self.contents().items():
            self.assertIn(b"async function fetchDroidModels", content)
            self.assertIn(b'default: "auto"', content)
            self.assertIn(b"supportedReasoningEfforts", content)
            self.assertIn(b"tokenMultiplier", content)
            self.assertIn(b"modelVariants: true", content)
            self.assertIn(b'selectModel: { configId: "model" }', content)
            self.assertIn(b'if (!turn.model)', content)
            backup = next(item for item in backups if item.name.startswith(Path(name).name + ".bak-"))
            self.assertEqual(backup.read_bytes(), self.originals[name])
        self.assertEqual(reapply.patch_files(self.root, reverse=True, check=True).returncode, 0)
        before = self.contents()
        mtimes = [(self.root / name).stat().st_mtime_ns for name in reapply.FILES]
        self.apply()
        self.assertEqual(self.contents(), before)
        self.assertEqual(self.backups(), backups)
        self.assertEqual([(self.root / name).stat().st_mtime_ns for name in reapply.FILES], mtimes)

    def test_line_offsets_can_change(self):
        for name in reapply.FILES:
            (self.root / name).write_bytes(b"// Unrelated new lines\n" * 17 + self.originals[name])
        self.apply()
        for content in self.contents().values():
            self.assertTrue(content.startswith(b"// Unrelated new lines\n" * 17))
            self.assertIn(b"async function fetchDroidModels", content)

    def test_incompatible_context_leaves_both_files_untouched(self):
        target = self.root / reapply.FILES[1]
        target.write_text(target.read_text().replace(
            "async function resolveModels(env)", "async function resolveModels(env, changed)",
        ))
        before = self.contents()
        with self.assertRaisesRegex(RuntimeError, "código mudou"):
            self.apply()
        self.assertEqual(self.contents(), before)
        self.assertEqual(self.backups(), [])

    def test_partial_patch_is_not_applied_again(self):
        self.apply()
        (self.root / reapply.FILES[1]).write_bytes(self.originals[reapply.FILES[1]])
        before, backups = self.contents(), self.backups()
        with self.assertRaisesRegex(RuntimeError, "patch está parcial"):
            self.apply()
        self.assertEqual(self.contents(), before)
        self.assertEqual(self.backups(), backups)

    def test_invalid_syntax_is_rejected_before_installation(self):
        target = self.root / reapply.FILES[1]
        target.write_bytes(self.originals[reapply.FILES[1]] + b"\nfunction {\n")
        before = self.contents()
        with self.assertRaisesRegex(RuntimeError, "node --check falhou"):
            self.apply()
        self.assertEqual(self.contents(), before)
        self.assertEqual(self.backups(), [])

    def test_write_failure_restores_the_first_file(self):
        real_replace = reapply.replace_file
        calls = 0

        def fail_second(path, content):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated write failure")
            real_replace(path, content)

        with patch.object(reapply, "replace_file", side_effect=fail_second):
            with self.assertRaisesRegex(OSError, "simulated write failure"):
                self.apply()
        self.assertEqual(self.contents(), self.originals)
        self.assertEqual(len(self.backups()), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
