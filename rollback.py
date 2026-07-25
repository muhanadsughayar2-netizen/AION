#!/usr/bin/env python3
"""
AION Rollback Tool
==================
Run from the Replit Shell tab:

  python rollback.py          → list all checkpoints
  python rollback.py <hash>   → roll back to that checkpoint
  python rollback.py undo     → undo the last rollback (go back to where you were)
"""

import subprocess, sys, os

def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip(), r.stderr.strip()

def list_checkpoints():
    out, _ = run("git log --oneline --no-walk=sorted --all 2>/dev/null || git log --oneline -40")
    out, _ = run("git log --pretty=format:'%C(yellow)%h%Creset  %C(cyan)%ar%Creset  %s' -40")
    print("\n📋 AION Checkpoints (most recent first)\n")
    print(f"  {'HASH':<10} {'WHEN':<22} DESCRIPTION")
    print("  " + "-"*70)
    raw, _ = run("git log --pretty=format:'%h|||%ar|||%s' -40")
    for line in raw.splitlines():
        parts = line.split("|||")
        if len(parts) == 3:
            h, when, msg = parts
            print(f"  {h:<10} {when:<22} {msg}")
    print()
    print("To roll back:  python rollback.py <hash>")
    print("To undo:       python rollback.py undo\n")

def rollback(hash_ref):
    # Save current position so user can undo
    current, _ = run("git rev-parse HEAD")
    
    # Verify the hash exists
    check, err = run(f"git cat-file -t {hash_ref} 2>&1")
    if "commit" not in check:
        print(f"\n❌ Checkpoint '{hash_ref}' not found. Run  python rollback.py  to see all checkpoints.\n")
        sys.exit(1)

    # Get description of target
    desc, _ = run(f"git log --oneline -1 {hash_ref}")
    print(f"\n⏪ Rolling back to: {desc}")
    print(f"   (saving current state {current[:8]} so you can undo)\n")

    # Save undo reference
    with open(".rollback_undo_ref", "w") as f:
        f.write(current)

    # Hard reset to the target commit
    out, err = run(f"git reset --hard {hash_ref}")
    if err and "HEAD is now at" not in out + err:
        print(f"❌ Rollback failed: {err}")
        sys.exit(1)

    head, _ = run("git log --oneline -1")
    print(f"✅ Rolled back successfully!\n")
    print(f"   Now at: {head}\n")
    print("   Reload your extension in Chrome to apply the changes.")
    print("   To undo this rollback: python rollback.py undo\n")

def undo():
    if not os.path.exists(".rollback_undo_ref"):
        print("\n❌ No rollback to undo — you haven't rolled back yet.\n")
        sys.exit(1)
    with open(".rollback_undo_ref") as f:
        ref = f.read().strip()
    desc, _ = run(f"git log --oneline -1 {ref}")
    print(f"\n↩️  Undoing rollback — returning to: {desc}\n")
    out, err = run(f"git reset --hard {ref}")
    os.remove(".rollback_undo_ref")
    head, _ = run("git log --oneline -1")
    print(f"✅ Undo complete!\n   Now at: {head}\n")
    print("   Reload your extension in Chrome to apply the changes.\n")

if __name__ == "__main__":
    if len(sys.argv) == 1:
        list_checkpoints()
    elif sys.argv[1] == "undo":
        undo()
    else:
        rollback(sys.argv[1])
