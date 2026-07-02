import sys
import pytest
from tests.helpers.cli_loader import load_script


@pytest.mark.skipif(sys.platform == "win32", reason="executable bit checks via os.access X_OK are not reliable on Windows")
def test_is_runnable_subcommand_requires_executable_file(tmp_path):
    cli = load_script("mavrick")
    sub = tmp_path / "mavrick-demo"
    sub.write_text("#!/bin/sh\n")
    sub.chmod(0o644)

    assert cli._is_runnable_subcommand(sub) is False

    sub.chmod(0o755)
    assert cli._is_runnable_subcommand(sub) is True
