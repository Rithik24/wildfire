"""A read-only, seekable file over HTTP range requests, for h5py.

h5py only touches the bytes it needs, so opening a remote netCDF-4/HDF5 granule
through this object and reading a few small datasets costs a handful of small
range requests instead of downloading the whole file. Reads are served from
aligned blocks that are cached for the life of the object.
"""

import io

import requests

_SESSION = requests.Session()
_SESSION.mount("https://", requests.adapters.HTTPAdapter(pool_connections=128, pool_maxsize=128))


class HttpFile(io.RawIOBase):
    def __init__(self, url, block=64 * 1024, session=None, size=None):
        self.url = url
        self.block = block
        self.s = session or _SESSION
        self.pos = 0
        self.blocks = {}
        self.requests = 0
        if size is None:
            r = self.s.head(url, timeout=30)
            r.raise_for_status()
            size = int(r.headers["Content-Length"])
        self.size = size

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def _fetch(self, first, last):
        """Fetch blocks first..last (inclusive) in one request."""
        start = first * self.block
        end = min(self.size, (last + 1) * self.block) - 1
        for attempt in range(4):
            try:
                r = self.s.get(self.url, headers={"Range": f"bytes={start}-{end}"}, timeout=60)
                if r.status_code in (200, 206):
                    break
            except requests.RequestException:
                if attempt == 3:
                    raise
        else:
            raise IOError(f"range read failed: {self.url}")
        self.requests += 1
        data = r.content
        if r.status_code == 200:  # server ignored the range
            data = data[start:end + 1]
        for k in range(first, last + 1):
            off = (k - first) * self.block
            self.blocks[k] = data[off:off + self.block]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        if n == 0:
            return b""
        first = self.pos // self.block
        last = (self.pos + n - 1) // self.block
        missing = [k for k in range(first, last + 1) if k not in self.blocks]
        if missing:
            self._fetch(missing[0], missing[-1])
        buf = b"".join(self.blocks[k] for k in range(first, last + 1))
        off = self.pos - first * self.block
        out = buf[off:off + n]
        self.pos += len(out)
        return out

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)
