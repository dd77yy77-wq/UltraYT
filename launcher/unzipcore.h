/*
 * unzipcore.h - small, dependency-free reader for a zip archive appended to an executable.
 * Supports stored, deflate and LZMA (method 14) entries (no zip64, no encryption). Used by the UltraYT single-file launcher.
 * The inflate code is written from the RFC 1951 description, the LZMA decoder is the public domain one from the LZMA SDK (lzma/).
 */
#ifndef UNZIPCORE_H
#define UNZIPCORE_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>

#include "lzma/LzmaDec.c" /* single translation unit, so the decoder is simply included */

/* ---------------------------------------------------------------- crc32 */

static uint32_t uz_crc_table[256];
static int uz_crc_ready = 0;

static void uz_crc_init(void) {
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t c = i;
        for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        uz_crc_table[i] = c;
    }
    uz_crc_ready = 1;
}

static uint32_t uz_crc32(uint32_t crc, const unsigned char *p, size_t n) {
    if (!uz_crc_ready) uz_crc_init();
    crc = ~crc;
    while (n--) crc = uz_crc_table[(crc ^ *p++) & 0xFF] ^ (crc >> 8);
    return ~crc;
}

/* -------------------------------------------------------------- inflate */

#define UZ_FAST 10

typedef struct {
    uint16_t fast[1 << UZ_FAST]; /* (symbol << 4) | length, 0 = not in the fast table */
    uint16_t count[16];
    uint16_t symbol[288];
} uz_huff;

typedef struct {
    const unsigned char *in, *inend;
    uint64_t bitbuf;
    int bitcnt;
    unsigned char *out;
    size_t outpos, outcap;
    int err;
} uz_state;

static void uz_refill(uz_state *s) {
    while (s->bitcnt <= 56 && s->in < s->inend) {
        s->bitbuf |= (uint64_t)(*s->in++) << s->bitcnt;
        s->bitcnt += 8;
    }
}

static unsigned uz_bits(uz_state *s, int n) {
    if (n == 0) return 0;
    uz_refill(s);
    if (s->bitcnt < n) { s->err = 1; return 0; }
    unsigned v = (unsigned)(s->bitbuf & ((1ULL << n) - 1));
    s->bitbuf >>= n;
    s->bitcnt -= n;
    return v;
}

static unsigned uz_reverse(unsigned code, int len) {
    unsigned r = 0;
    for (int i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>= 1; }
    return r;
}

/* lengths[0..n-1] are the code lengths; returns 0 on success, -1 if over-subscribed */
static int uz_build(uz_huff *h, const uint8_t *lengths, int n) {
    int len, sym, left = 1;
    memset(h->count, 0, sizeof h->count);
    for (sym = 0; sym < n; sym++) h->count[lengths[sym]]++;
    for (len = 1; len <= 15; len++) {
        left <<= 1;
        left -= h->count[len];
        if (left < 0) return -1;
    }

    uint16_t offs[16];
    offs[1] = 0;
    for (len = 1; len < 15; len++) offs[len + 1] = (uint16_t)(offs[len] + h->count[len]);
    for (sym = 0; sym < n; sym++) {
        if (lengths[sym]) h->symbol[offs[lengths[sym]]++] = (uint16_t)sym;
    }

    memset(h->fast, 0, sizeof h->fast);
    unsigned next_code[16];
    unsigned code = 0;
    next_code[0] = 0;
    for (len = 1; len <= 15; len++) {
        code = (code + (len > 1 ? h->count[len - 1] : 0)) << 1;
        next_code[len] = code;
    }
    for (sym = 0; sym < n; sym++) {
        len = lengths[sym];
        if (!len) continue;
        unsigned c = next_code[len]++;
        if (len <= UZ_FAST) {
            unsigned rev = uz_reverse(c, len);
            for (unsigned k = rev; k < (1u << UZ_FAST); k += (1u << len)) {
                h->fast[k] = (uint16_t)((sym << 4) | len);
            }
        }
    }
    return 0;
}

static int uz_decode(uz_state *s, const uz_huff *h) {
    uz_refill(s);
    unsigned e = h->fast[s->bitbuf & ((1u << UZ_FAST) - 1)];
    if (e) {
        int len = e & 15;
        if (len > s->bitcnt) { s->err = 1; return -1; }
        s->bitbuf >>= len;
        s->bitcnt -= len;
        return (int)(e >> 4);
    }

    int code = 0, first = 0, index = 0;
    for (int len = 1; len <= 15; len++) {
        if (s->bitcnt <= 0) { s->err = 1; return -1; }
        code |= (int)(s->bitbuf & 1);
        s->bitbuf >>= 1;
        s->bitcnt--;
        int count = h->count[len];
        if (code - count < first) return h->symbol[index + (code - first)];
        index += count;
        first += count;
        first <<= 1;
        code <<= 1;
    }
    s->err = 1;
    return -1;
}

static const uint16_t uz_lbase[29] = { 3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258 };
static const uint16_t uz_lext[29]  = { 0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0 };
static const uint16_t uz_dbase[30] = { 1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577 };
static const uint16_t uz_dext[30]  = { 0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13 };

static int uz_codes(uz_state *s, const uz_huff *lh, const uz_huff *dh) {
    for (;;) {
        int sym = uz_decode(s, lh);
        if (sym < 0) return -1;
        if (sym < 256) {
            if (s->outpos >= s->outcap) { s->err = 1; return -1; }
            s->out[s->outpos++] = (unsigned char)sym;
        } else if (sym == 256) {
            return 0;
        } else {
            sym -= 257;
            if (sym >= 29) { s->err = 1; return -1; }
            unsigned len = uz_lbase[sym] + uz_bits(s, uz_lext[sym]);
            int ds = uz_decode(s, dh);
            if (ds < 0 || ds >= 30) { s->err = 1; return -1; }
            unsigned dist = uz_dbase[ds] + uz_bits(s, uz_dext[ds]);
            if (s->err) return -1;
            if (dist > s->outpos || s->outpos + len > s->outcap) { s->err = 1; return -1; }
            const unsigned char *src = s->out + s->outpos - dist;
            unsigned char *dst = s->out + s->outpos;
            if (dist >= len) memcpy(dst, src, len);
            else for (unsigned i = 0; i < len; i++) dst[i] = src[i];
            s->outpos += len;
        }
    }
}

static int uz_dynamic(uz_state *s, uz_huff *lh, uz_huff *dh) {
    static const uint8_t order[19] = { 16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15 };
    uint8_t lengths[320];
    int nlen = (int)uz_bits(s, 5) + 257;
    int ndist = (int)uz_bits(s, 5) + 1;
    int ncode = (int)uz_bits(s, 4) + 4;
    if (s->err || nlen > 286 || ndist > 30) { s->err = 1; return -1; }

    int i;
    for (i = 0; i < 19; i++) lengths[i] = 0;
    for (i = 0; i < ncode; i++) lengths[order[i]] = (uint8_t)uz_bits(s, 3);
    if (s->err) return -1;

    uz_huff ch;
    if (uz_build(&ch, lengths, 19)) { s->err = 1; return -1; }

    i = 0;
    while (i < nlen + ndist) {
        int sym = uz_decode(s, &ch);
        if (sym < 0) return -1;
        if (sym < 16) {
            lengths[i++] = (uint8_t)sym;
        } else {
            int len = 0, rep;
            if (sym == 16) {
                if (i == 0) { s->err = 1; return -1; }
                len = lengths[i - 1];
                rep = 3 + (int)uz_bits(s, 2);
            } else if (sym == 17) {
                rep = 3 + (int)uz_bits(s, 3);
            } else {
                rep = 11 + (int)uz_bits(s, 7);
            }
            if (s->err || i + rep > nlen + ndist) { s->err = 1; return -1; }
            while (rep--) lengths[i++] = (uint8_t)len;
        }
    }
    if (lengths[256] == 0) { s->err = 1; return -1; }
    if (uz_build(lh, lengths, nlen)) { s->err = 1; return -1; }
    if (uz_build(dh, lengths + nlen, ndist)) { s->err = 1; return -1; }
    return 0;
}

/* inflates exactly outcap bytes; returns 0 on success */
static int uz_inflate(const unsigned char *in, size_t inlen, unsigned char *out, size_t outcap) {
    uz_state s;
    memset(&s, 0, sizeof s);
    s.in = in; s.inend = in + inlen; s.out = out; s.outcap = outcap;

    uz_huff lh, dh;
    int last;
    do {
        last = (int)uz_bits(&s, 1);
        int type = (int)uz_bits(&s, 2);
        if (s.err) return -1;

        if (type == 0) {
            int drop = s.bitcnt & 7;
            s.bitbuf >>= drop;
            s.bitcnt -= drop;
            unsigned len = uz_bits(&s, 16);
            unsigned nlen = uz_bits(&s, 16);
            if (s.err || (len ^ 0xFFFFu) != nlen) return -1;
            while (len && s.bitcnt >= 8) {
                if (s.outpos >= s.outcap) return -1;
                out[s.outpos++] = (unsigned char)(s.bitbuf & 0xFF);
                s.bitbuf >>= 8;
                s.bitcnt -= 8;
                len--;
            }
            if (len) {
                if ((size_t)(s.inend - s.in) < len || s.outpos + len > s.outcap) return -1;
                memcpy(out + s.outpos, s.in, len);
                s.in += len;
                s.outpos += len;
            }
        } else if (type == 1) {
            uint8_t lengths[288];
            int i;
            for (i = 0; i < 144; i++) lengths[i] = 8;
            for (; i < 256; i++) lengths[i] = 9;
            for (; i < 280; i++) lengths[i] = 7;
            for (; i < 288; i++) lengths[i] = 8;
            uz_build(&lh, lengths, 288);
            for (i = 0; i < 30; i++) lengths[i] = 5;
            uz_build(&dh, lengths, 30);
            if (uz_codes(&s, &lh, &dh)) return -1;
        } else if (type == 2) {
            if (uz_dynamic(&s, &lh, &dh)) return -1;
            if (uz_codes(&s, &lh, &dh)) return -1;
        } else {
            return -1;
        }
    } while (!last);

    return s.outpos == outcap ? 0 : -1;
}

/* ----------------------------------------------------------------- lzma */

static void *uz_lzma_alloc(ISzAllocPtr p, size_t size) { (void)p; return malloc(size ? size : 1); }
static void uz_lzma_free(ISzAllocPtr p, void *address) { (void)p; free(address); }

/* zip method 14: 2 bytes version, 2 bytes properties size (5), the properties, then the raw LZMA stream.
 * unpacks exactly outcap bytes; whatever follows them (an end marker) is not looked at */
static int uz_lzma(const unsigned char *in, size_t inlen, unsigned char *out, size_t outcap) {
    if (inlen < 9 || in[2] != 5 || in[3] != 0) return -1;

    ISzAlloc alloc = { uz_lzma_alloc, uz_lzma_free };
    SizeT destLen = outcap, srcLen = inlen - 9;
    ELzmaStatus status;

    SRes res = LzmaDecode(out, &destLen, in + 9, &srcLen, in + 4, 5, LZMA_FINISH_ANY, &status, &alloc);
    if (res != SZ_OK || destLen != outcap) return -1;
    return 0;
}

/* ------------------------------------------------------------------ zip */

typedef struct {
    const unsigned char *data;   /* whole file */
    uint64_t size;
    const unsigned char *cd;     /* central directory */
    uint32_t cd_size;
    uint32_t count;
    uint64_t base;               /* size of whatever precedes the zip data (the launcher) */
    uint32_t id_a, id_b;         /* identifies this exact payload */
} uz_zip;

typedef struct {
    const unsigned char *name;
    unsigned name_len;
    unsigned method;
    uint32_t crc, csize, usize, lho;
} uz_entry;

static unsigned uz_u16(const unsigned char *p) { return (unsigned)p[0] | ((unsigned)p[1] << 8); }
static uint32_t uz_u32(const unsigned char *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

static int uz_open(uz_zip *z, const unsigned char *data, uint64_t size) {
    if (size < 22) return -1;
    uint64_t maxback = size < 22 + 65535 ? size : 22 + 65535;
    for (uint64_t back = 22; back <= maxback; back++) {
        const unsigned char *p = data + size - back;
        if (uz_u32(p) != 0x06054b50u || back != 22 + (uint64_t)uz_u16(p + 20)) continue;

        uint32_t count = uz_u16(p + 10);
        uint32_t cd_size = uz_u32(p + 12);
        uint32_t cd_off = uz_u32(p + 16);
        if (count == 0xFFFF || cd_size == 0xFFFFFFFFu || cd_off == 0xFFFFFFFFu) return -1; /* zip64 */

        uint64_t eocd_pos = size - back;
        if ((uint64_t)cd_size + cd_off > eocd_pos) return -1;

        z->data = data;
        z->size = size;
        z->count = count;
        z->cd_size = cd_size;
        z->base = eocd_pos - cd_size - cd_off;
        z->cd = data + z->base + cd_off;
        z->id_a = uz_crc32(0, z->cd, cd_size);
        z->id_b = (uint32_t)size;
        return 0;
    }
    return -1;
}

/* reads the entry that starts at p, returns where the next one starts (or NULL on a bad directory) */
static const unsigned char *uz_entry_at(const uz_zip *z, const unsigned char *p, uz_entry *e) {
    const unsigned char *end = z->cd + z->cd_size;
    if (p + 46 > end || uz_u32(p) != 0x02014b50u) return NULL;
    unsigned nl = uz_u16(p + 28), xl = uz_u16(p + 30), cl = uz_u16(p + 32);
    if (p + 46 + nl + xl + cl > end) return NULL;

    e->method = uz_u16(p + 10);
    e->crc = uz_u32(p + 16);
    e->csize = uz_u32(p + 20);
    e->usize = uz_u32(p + 24);
    e->lho = uz_u32(p + 42);
    e->name = p + 46;
    e->name_len = nl;
    if (e->csize == 0xFFFFFFFFu || e->usize == 0xFFFFFFFFu || e->lho == 0xFFFFFFFFu) return NULL;
    return p + 46 + nl + xl + cl;
}

/* decompresses one entry into out (usize bytes) and checks its crc; returns 0 on success */
static int uz_extract(const uz_zip *z, const uz_entry *e, unsigned char *out) {
    uint64_t lp = z->base + e->lho;
    if (lp + 30 > z->size) return -1;
    const unsigned char *l = z->data + lp;
    if (uz_u32(l) != 0x04034b50u) return -1;
    uint64_t start = lp + 30 + uz_u16(l + 26) + uz_u16(l + 28);
    if (start + e->csize > z->size) return -1;
    const unsigned char *cdata = z->data + start;

    if (e->method == 0) {
        if (e->csize != e->usize) return -1;
        if (e->usize) memcpy(out, cdata, e->usize);
    } else if (e->method == 8) {
        if (e->usize && uz_inflate(cdata, e->csize, out, e->usize)) return -1;
    } else if (e->method == 14) {
        if (e->usize && uz_lzma(cdata, e->csize, out, e->usize)) return -1;
    } else {
        return -1;
    }

    if (uz_crc32(0, out, e->usize) != e->crc) return -2;
    return 0;
}

#endif
