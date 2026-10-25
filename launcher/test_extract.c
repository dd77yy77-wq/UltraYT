/* Linux test for unzipcore.h: extracts the zip appended to a file into a directory (same logic the Windows launcher uses). */
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include "unzipcore.h"

static void mkdirs(char *path) {
    for (char *p = path + 1; *p; p++) {
        if (*p == '/') { *p = 0; mkdir(path, 0755); *p = '/'; }
    }
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s file.exe outdir\n", argv[0]); return 2; }
    int fd = open(argv[1], O_RDONLY);
    if (fd < 0) { perror("open"); return 2; }
    struct stat st;
    fstat(fd, &st);
    const unsigned char *data = mmap(NULL, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
    if (data == MAP_FAILED) { perror("mmap"); return 2; }

    uz_zip z;
    if (uz_open(&z, data, st.st_size)) { fprintf(stderr, "no zip found\n"); return 1; }
    printf("entries=%u base=%llu id=%08x%08x\n", z.count, (unsigned long long)z.base, z.id_a, z.id_b);

    const unsigned char *p = z.cd;
    unsigned long long total = 0;
    unsigned files = 0;
    for (uint32_t i = 0; i < z.count; i++) {
        uz_entry e;
        const unsigned char *next = uz_entry_at(&z, p, &e);
        if (!next) { fprintf(stderr, "bad central directory at entry %u\n", i); return 1; }
        p = next;

        char rel[1024];
        if (e.name_len == 0 || e.name_len >= sizeof rel - 1) return 1;
        memcpy(rel, e.name, e.name_len);
        rel[e.name_len] = 0;
        if (strstr(rel, "..") || rel[0] == '/') { fprintf(stderr, "unsafe name %s\n", rel); return 1; }

        char full[2048];
        snprintf(full, sizeof full, "%s/%s", argv[2], rel);
        if (rel[e.name_len - 1] == '/') { mkdirs(full); mkdir(full, 0755); continue; }
        mkdirs(full);

        unsigned char *buf = malloc(e.usize ? e.usize : 1);
        int rc = uz_extract(&z, &e, buf);
        if (rc) { fprintf(stderr, "extract failed (%d): %s\n", rc, rel); return 1; }
        FILE *f = fopen(full, "wb");
        if (!f) { perror(full); return 1; }
        if (e.usize) fwrite(buf, 1, e.usize, f);
        fclose(f);
        free(buf);
        total += e.usize;
        files++;
    }
    printf("extracted %u files, %llu bytes\n", files, total);
    return 0;
}
