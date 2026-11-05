#!/usr/bin/env python3
"""Regenerates p256.json (EIP-7951 semantics vectors) and codes.json (DESIGN §3.5 frozen codes).

Deterministic: fixed private keys and RFC 6979 is not needed because the signatures are pinned in the json.
Run: python3 test/vectors/gen_vectors.py  (needs the `cryptography` package)."""
import hashlib, json, os
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes

N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
here = os.path.dirname(os.path.abspath(__file__))
h32 = lambda i: "0x%064x" % i

def sign(d, msg):
    k = ec.derive_private_key(d, ec.SECP256R1())
    h = hashlib.sha256(msg).digest()
    r, s = utils.decode_dss_signature(k.sign(h, ec.ECDSA(utils.Prehashed(hashes.SHA256()))))
    if s > N // 2:
        s = N - s
    pub = k.public_key().public_numbers()
    return int.from_bytes(h, "big"), r, s, pub.x, pub.y

vectors = []
def add(name, h, r, s, x, y, valid, low_s=True):
    vectors.append(dict(name=name, hash=h32(h), r=h32(r), s=h32(s), x=h32(x), y=h32(y), valid=valid, lowS=low_s))

h, r, s, x, y = sign(0xC0FFEE, b"stamper vector 1")
add("valid-1", h, r, s, x, y, True)
h2, r2, s2, x2, y2 = sign(0xBEEF1234, b"stamper vector 2")
add("valid-2", h2, r2, s2, x2, y2, True)
add("high-s (precompile accepts, Stamper rejects)", h, r, N - s, x, y, True, False)
add("wrong hash", h ^ 1, r, s, x, y, False)
add("r = 0", h, 0, s, x, y, False)
add("s = 0", h, r, 0, x, y, False)
add("r = n", h, N, s, x, y, False)
add("s = n", h, r, N, x, y, False)
add("point not on curve", h, r, s, x, y ^ 1, False)
add("point at infinity", h, r, s, 0, 0, False)
add("other key", h, r, s, x2, y2, False)
json.dump({"count": len(vectors), "vectors": vectors}, open(os.path.join(here, "p256.json"), "w"), indent=2)

ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CHECK = ALPHA + "*~$=U"
codes = []
for byte, text, attempt in [("11", "5VEB-TVRA-F", 0), ("ab", "MR58-TTN8-D", 1), ("07", "6NJ9-RNXC-P", 0), ("c3", "W0SB-9TAX-B", 0)]:
    sym = text.replace("-", "")
    v = 0
    for ch in sym[:8]:
        v = v * 32 + ALPHA.index(ch)
    assert CHECK[v % 37] == sym[8], text
    codes.append(dict(stampId="0x" + byte * 32, code=v, display=text, attempt=attempt))
json.dump({"count": len(codes), "vectors": codes}, open(os.path.join(here, "codes.json"), "w"), indent=2)
print("ok", len(vectors), len(codes))
