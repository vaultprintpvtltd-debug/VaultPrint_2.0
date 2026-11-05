/*
 * vp-gutenprint — PNM pages in, printer data out, via libgutenprint.
 *
 * For inkjets Ghostscript can't drive itself (e.g. Canon PIXMA G2010, which
 * speaks BJRaster3 inside Canon's IVEC job wrapper). No CUPS needed:
 *
 *   gs -sDEVICE=pgmraw|ppmraw -r300 ... -sOutputFile=- doc.pdf \
 *     | vp-gutenprint -d bjc-G2000-series [-m BW|Color] [-s A4] > job.prn
 *
 * Reads concatenated binary PNM pages (P5 gray or P6 RGB, maxval 255) from
 * stdin, each covering the full page, and streams rows straight into
 * Gutenprint (constant memory). Writes one print job to stdout and
 * "pages N" to stderr.
 *
 * Gutenprint's printer data is found through STP_DATA_PATH.
 * Exit codes: 0 ok, 1 bad input / no pages, 2 unknown driver, 3 print failed.
 */
#include <gutenprint/gutenprint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct page {
	int w, h, ch;        /* source pixels, channels (1 gray, 3 RGB) */
	int x0, y0, cw, chh; /* crop to the printable area, in source pixels */
	int next_row;        /* next source row to read from stdin */
	unsigned char *buf;  /* one source row */
};

static void out_fn(void *data, const char *buf, size_t n)
{
	if (fwrite(buf, 1, n, (FILE *)data) != n) { perror("write"); exit(3); }
}

static void err_fn(void *data, const char *buf, size_t n)
{
	(void)data;
	fwrite(buf, 1, n, stderr);
}

/* Parse "P5|P6 <w> <h> 255" with comments. Returns 0 on EOF, -1 bad, 1 ok. */
static int read_pnm_header(FILE *f, struct page *p)
{
	int c = fgetc(f);
	while (c == '\n' || c == ' ' || c == '\r' || c == '\t') c = fgetc(f);
	if (c == EOF) return 0;
	int t = fgetc(f);
	if (c != 'P' || (t != '5' && t != '6')) return -1;
	p->ch = t == '5' ? 1 : 3;
	int v[3], i = 0;
	while (i < 3) {
		c = fgetc(f);
		if (c == EOF) return -1;
		if (c == '#') { while (c != '\n' && c != EOF) c = fgetc(f); continue; }
		if (c >= '0' && c <= '9') {
			int n = 0;
			while (c >= '0' && c <= '9') { n = n * 10 + (c - '0'); c = fgetc(f); }
			v[i++] = n;
		}
	}
	/* c is the single whitespace byte that ends the header */
	if (v[2] != 255 || v[0] <= 0 || v[1] <= 0) return -1;
	p->w = v[0];
	p->h = v[1];
	p->next_row = 0;
	return 1;
}

static int read_row(struct page *p)
{
	size_t n = (size_t)p->w * p->ch;
	if (fread(p->buf, 1, n, stdin) != n) return -1;
	p->next_row++;
	return 0;
}

static int img_width(stp_image_t *im) { return ((struct page *)im->rep)->cw; }
static int img_height(stp_image_t *im) { return ((struct page *)im->rep)->chh; }
static void img_noop(stp_image_t *im) { (void)im; }
static const char *img_app(stp_image_t *im) { (void)im; return "vp-gutenprint"; }

static stp_image_status_t img_row(stp_image_t *im, unsigned char *data, size_t limit, int row)
{
	struct page *p = im->rep;
	int src = p->y0 + row;
	if (src < p->next_row - 1) return STP_IMAGE_STATUS_ABORT; /* rows are requested in order */
	while (p->next_row <= src)
		if (read_row(p)) return STP_IMAGE_STATUS_ABORT;
	size_t n = (size_t)p->cw * p->ch;
	if (n > limit) n = limit;
	memcpy(data, p->buf + (size_t)p->x0 * p->ch, n);
	return STP_IMAGE_STATUS_OK;
}

/* Skip whatever rows of this page Gutenprint didn't ask for */
static int drain_page(struct page *p)
{
	while (p->next_row < p->h)
		if (read_row(p)) return -1;
	return 0;
}

/* Every option not set explicitly takes the driver's own default (as the
 * CUPS filter does via the PPD) — otherwise stp_verify() rejects the job. */
static void fill_defaults(stp_vars_t *v)
{
	stp_parameter_list_t list = stp_get_parameter_list(v);
	size_t n = stp_parameter_list_count(list);
	for (size_t i = 0; i < n; i++) {
		const stp_parameter_t *p = stp_parameter_list_param(list, i);
		if (p->p_type != STP_PARAMETER_TYPE_STRING_LIST) continue;
		if (stp_check_string_parameter(v, p->name, STP_PARAMETER_INACTIVE)) continue;
		stp_parameter_t d;
		stp_describe_parameter(v, p->name, &d);
		if (d.p_type == STP_PARAMETER_TYPE_STRING_LIST && d.deflt.str)
			stp_set_string_parameter(v, p->name, d.deflt.str);
		stp_parameter_description_destroy(&d);
	}
	stp_parameter_list_destroy(list);
}

int main(int argc, char **argv)
{
	const char *driver = "bjc-G2000-series", *mode = NULL, *size = "A4";
	const char *media = "Plain", *quality = "Standard";
	int opt;
	while ((opt = getopt(argc, argv, "d:m:s:t:q:")) != -1) {
		switch (opt) {
		case 'd': driver = optarg; break;
		case 'm': mode = optarg; break;
		case 's': size = optarg; break;
		case 't': media = optarg; break;
		case 'q': quality = optarg; break;
		default:
			fprintf(stderr, "usage: %s [-d driver] [-m BW|Color] [-s A4] [-t Plain] [-q Standard] < pages.pnm > job.prn\n", argv[0]);
			return 64;
		}
	}

	stp_init();
	const stp_printer_t *printer = stp_get_printer_by_driver(driver);
	if (!printer) { fprintf(stderr, "unknown Gutenprint driver %s (check STP_DATA_PATH)\n", driver); return 2; }

	struct page pg;
	memset(&pg, 0, sizeof pg);
	int r = read_pnm_header(stdin, &pg);
	if (r <= 0) { fprintf(stderr, "no PNM page on stdin\n"); return 1; }

	stp_vars_t *v = stp_vars_create_copy(stp_printer_get_defaults(printer));
	stp_set_driver(v, driver);
	stp_set_outfunc(v, out_fn);
	stp_set_outdata(v, stdout);
	stp_set_errfunc(v, err_fn);
	stp_set_errdata(v, stderr);
	stp_set_string_parameter(v, "PageSize", size);
	stp_set_string_parameter(v, "MediaType", media);
	stp_set_string_parameter(v, "Quality", quality);
	stp_set_string_parameter(v, "PrintingMode", mode ? mode : (pg.ch == 1 ? "BW" : "Color"));
	stp_set_string_parameter(v, "InputImageType", pg.ch == 1 ? "Whitescale" : "RGB");
	stp_set_string_parameter(v, "ChannelBitDepth", "8");
	stp_set_string_parameter(v, "JobMode", "Job");
	fill_defaults(v);

	stp_dimension_t pw, ph, left, right, bottom, top;
	stp_get_media_size(v, &pw, &ph);
	stp_set_page_width(v, pw);
	stp_set_page_height(v, ph);
	stp_get_imageable_area(v, &left, &right, &bottom, &top);
	stp_set_left(v, left);
	stp_set_top(v, top);
	stp_set_width(v, right - left);
	stp_set_height(v, bottom - top);

	stp_image_t im = {
		.init = img_noop, .reset = img_noop, .width = img_width, .height = img_height,
		.get_row = img_row, .get_appname = img_app, .conclude = img_noop, .rep = &pg,
	};

	int pages = 0, started = 0, ch0 = pg.ch;
	while (r > 0) {
		if (pg.ch != ch0) { fprintf(stderr, "page %d: mixed gray/RGB pages\n", pages + 1); return 1; }
		/* The source covers the whole page: map the printable area onto it */
		double sx = pg.w / pw, sy = pg.h / ph;
		pg.x0 = (int)(left * sx + 0.5);
		pg.y0 = (int)(top * sy + 0.5);
		pg.cw = (int)((right - left) * sx + 0.5);
		pg.chh = (int)((bottom - top) * sy + 0.5);
		if (pg.x0 + pg.cw > pg.w) pg.cw = pg.w - pg.x0;
		if (pg.y0 + pg.chh > pg.h) pg.chh = pg.h - pg.y0;
		free(pg.buf);
		pg.buf = malloc((size_t)pg.w * pg.ch);
		if (!pg.buf) { perror("malloc"); return 3; }

		if (!started) {
			if (!stp_verify(v)) { fprintf(stderr, "Gutenprint rejected the settings\n"); return 3; }
			stp_start_job(v, &im);
			started = 1;
		}
		if (!stp_print(v, &im)) { fprintf(stderr, "page %d: print failed\n", pages + 1); return 3; }
		if (drain_page(&pg)) { fprintf(stderr, "page %d: truncated input\n", pages + 1); return 1; }
		pages++;
		r = read_pnm_header(stdin, &pg);
	}
	if (r < 0) { fprintf(stderr, "bad PNM data after page %d\n", pages); return 1; }
	stp_end_job(v, &im);
	fflush(stdout);
	stp_vars_destroy(v);
	fprintf(stderr, "pages %d\n", pages);
	return 0;
}
