"""Build the C physics core.

    .venv/bin/python tools/build.py          # public/physics.wasm (browser) + build/libphysics.<ext> (tests)

Uses the Zig toolchain from the `ziglang` pip package (clang + wasm-ld bundled), so no system LLVM is needed.
The wasm is a WASI "reactor" with no imports beyond libm, exporting every EXPORT(...) function and its memory.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = sorted(str(p) for p in (ROOT / "physics").glob("*.c"))
ZIG = [sys.executable, "-m", "ziglang", "cc"]


def run(args):
    print("zig cc " + " ".join(a.replace(str(ROOT) + "/", "") for a in args))
    subprocess.run(ZIG + args, check=True)


def main():
    (ROOT / "build").mkdir(exist_ok=True)
    run(["--target=wasm32-wasi", "-O2", "-mexec-model=reactor", "-Wl,--no-entry", "-Wl,--export-dynamic",
         "-Wl,--strip-all", "-o", str(ROOT / "public" / "physics.wasm")] + SRC)
    ext = "dylib" if sys.platform == "darwin" else "so"
    run(["-O2", "-shared", "-fPIC", "-o", str(ROOT / "build" / f"libphysics.{ext}")] + SRC)


if __name__ == "__main__":
    main()
