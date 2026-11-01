/*
 * vp-usbprint — minimal USB printer-class client over Linux usbfs.
 *
 * For Android kernels built without CONFIG_USB_PRINTER (no /dev/usb/lp0).
 * Talks to the printer's bulk endpoints directly via /dev/bus/usb/BBB/DDD,
 * which requires root (or a chmod'ed device node).
 *
 * Usage:
 *   vp-usbprint [-d VID:PID] id              IEEE-1284 device ID string
 *   vp-usbprint [-d VID:PID] status          port status byte, decoded
 *   vp-usbprint [-d VID:PID] [-t ms] send    copy stdin to the printer
 *   vp-usbprint [-d VID:PID] find            print /dev/bus/usb path
 *
 * Default device: 03f0:2b17 (HP LaserJet 1020).
 * Exit codes: 0 ok, 2 printer not found, 3 printer stopped accepting data
 *             (stall timeout), 4 USB / IO error, 64 usage.
 */
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/usbdevice_fs.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define SYSFS "/sys/bus/usb/devices"

struct printer {
	char sysdir[256];
	char node[64];
	int ifnum, alt;
	unsigned char ep_out, ep_in;
};

static int read_str(const char *path, char *buf, size_t n)
{
	FILE *f = fopen(path, "r");
	if (!f) return -1;
	if (!fgets(buf, (int)n, f)) { fclose(f); return -1; }
	fclose(f);
	buf[strcspn(buf, "\r\n")] = 0;
	return 0;
}

static int read_int(const char *path, int base)
{
	char b[32];
	if (read_str(path, b, sizeof b)) return -1;
	return (int)strtol(b, NULL, base);
}

/* Locate the device and its printer-class (07) interface + bulk endpoints. */
static int find_printer(const char *vid, const char *pid, struct printer *p)
{
	DIR *d = opendir(SYSFS);
	struct dirent *e;
	char path[512], v[16], q[16];
	int found = 0;

	if (!d) return -1;
	while (!found && (e = readdir(d))) {
		if (strchr(e->d_name, ':') || e->d_name[0] == '.') continue;
		snprintf(path, sizeof path, SYSFS "/%s/idVendor", e->d_name);
		if (read_str(path, v, sizeof v)) continue;
		snprintf(path, sizeof path, SYSFS "/%s/idProduct", e->d_name);
		if (read_str(path, q, sizeof q)) continue;
		if (strcasecmp(v, vid) || strcasecmp(q, pid)) continue;

		snprintf(p->sysdir, sizeof p->sysdir, SYSFS "/%s", e->d_name);
		snprintf(path, sizeof path, "%s/busnum", p->sysdir);
		int bus = read_int(path, 10);
		snprintf(path, sizeof path, "%s/devnum", p->sysdir);
		int dev = read_int(path, 10);
		snprintf(p->node, sizeof p->node, "/dev/bus/usb/%03d/%03d", bus, dev);
		found = 1;
	}
	closedir(d);
	if (!found) return -1;

	/* Interfaces are named "<dev>:<config>.<if>" */
	d = opendir(SYSFS);
	if (!d) return -1;
	const char *base = strrchr(p->sysdir, '/') + 1;
	size_t blen = strlen(base);
	p->ep_out = p->ep_in = 0;
	while ((e = readdir(d))) {
		if (strncmp(e->d_name, base, blen) || e->d_name[blen] != ':') continue;
		snprintf(path, sizeof path, SYSFS "/%s/bInterfaceClass", e->d_name);
		if (read_int(path, 16) != 0x07) continue;
		snprintf(path, sizeof path, SYSFS "/%s/bInterfaceNumber", e->d_name);
		p->ifnum = read_int(path, 16);
		snprintf(path, sizeof path, SYSFS "/%s/bAlternateSetting", e->d_name);
		p->alt = read_int(path, 10);
		if (p->alt < 0) p->alt = 0;

		char ifdir[300];
		snprintf(ifdir, sizeof ifdir, SYSFS "/%s", e->d_name);
		DIR *id = opendir(ifdir);
		struct dirent *ee;
		while (id && (ee = readdir(id))) {
			if (strncmp(ee->d_name, "ep_", 3)) continue;
			char t[32], dir[16];
			snprintf(path, sizeof path, "%s/%s/type", ifdir, ee->d_name);
			if (read_str(path, t, sizeof t) || strcmp(t, "Bulk")) continue;
			snprintf(path, sizeof path, "%s/%s/direction", ifdir, ee->d_name);
			if (read_str(path, dir, sizeof dir)) continue;
			unsigned char addr = (unsigned char)strtol(ee->d_name + 3, NULL, 16);
			if (!strcmp(dir, "out") && !p->ep_out) p->ep_out = addr;
			if (!strcmp(dir, "in") && !p->ep_in) p->ep_in = addr;
		}
		if (id) closedir(id);
		break;
	}
	closedir(d);
	return p->ep_out ? 0 : -1;
}

static int open_claim(struct printer *p)
{
	int fd = open(p->node, O_RDWR);
	if (fd < 0) { fprintf(stderr, "open %s: %s\n", p->node, strerror(errno)); return -1; }
	unsigned int ifn = (unsigned int)p->ifnum;
	if (ioctl(fd, USBDEVFS_CLAIMINTERFACE, &ifn) < 0) {
		/* A kernel driver holds it — detach and retry */
		struct usbdevfs_ioctl cmd = { .ifno = p->ifnum, .ioctl_code = USBDEVFS_DISCONNECT, .data = NULL };
		ioctl(fd, USBDEVFS_IOCTL, &cmd);
		if (ioctl(fd, USBDEVFS_CLAIMINTERFACE, &ifn) < 0) {
			fprintf(stderr, "claim interface %d: %s\n", p->ifnum, strerror(errno));
			close(fd);
			return -1;
		}
	}
	return fd;
}

static void release_close(int fd, struct printer *p)
{
	unsigned int ifn = (unsigned int)p->ifnum;
	ioctl(fd, USBDEVFS_RELEASEINTERFACE, &ifn);
	close(fd);
}

static int cmd_id(int fd, struct printer *p)
{
	unsigned char buf[1024];
	struct usbdevfs_ctrltransfer c = {
		.bRequestType = 0xA1, .bRequest = 0, /* GET_DEVICE_ID */
		.wValue = 0, .wIndex = (unsigned short)((p->ifnum << 8) | p->alt),
		.wLength = sizeof buf, .timeout = 5000, .data = buf,
	};
	int n = ioctl(fd, USBDEVFS_CONTROL, &c);
	if (n < 2) { fprintf(stderr, "GET_DEVICE_ID: %s\n", n < 0 ? strerror(errno) : "short"); return 4; }
	int len = (buf[0] << 8) | buf[1]; /* big-endian, includes the 2 length bytes */
	if (len > n || len < 2) len = n;
	fwrite(buf + 2, 1, (size_t)(len - 2), stdout);
	putchar('\n');
	return 0;
}

static int cmd_status(int fd, struct printer *p)
{
	unsigned char b = 0;
	struct usbdevfs_ctrltransfer c = {
		.bRequestType = 0xA1, .bRequest = 1, /* GET_PORT_STATUS */
		.wValue = 0, .wIndex = (unsigned short)p->ifnum,
		.wLength = 1, .timeout = 5000, .data = &b,
	};
	if (ioctl(fd, USBDEVFS_CONTROL, &c) != 1) { fprintf(stderr, "GET_PORT_STATUS: %s\n", strerror(errno)); return 4; }
	printf("raw=0x%02x paper_empty=%d selected=%d error=%d\n",
	       b, !!(b & 0x20), !!(b & 0x10), !(b & 0x08));
	return 0;
}

static long now_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

/* Copy stdin to the bulk OUT endpoint. Fails if the printer accepts no data
 * for stall_ms (powered off mid-job, jam, out of paper with a full buffer). */
static int cmd_send(int fd, struct printer *p, long stall_ms)
{
	static unsigned char buf[16384];
	long long total = 0;
	ssize_t n;

	while ((n = read(STDIN_FILENO, buf, sizeof buf)) > 0) {
		ssize_t off = 0;
		long last_progress = now_ms();
		while (off < n) {
			struct usbdevfs_bulktransfer bt = {
				.ep = p->ep_out, .len = (unsigned int)(n - off),
				.timeout = 2000, .data = buf + off,
			};
			int w = ioctl(fd, USBDEVFS_BULK, &bt);
			if (w > 0) {
				off += w;
				total += w;
				last_progress = now_ms();
				continue;
			}
			if (w < 0 && errno != ETIMEDOUT && errno != EAGAIN) {
				fprintf(stderr, "bulk write: %s (sent %lld bytes)\n", strerror(errno), total);
				return 4;
			}
			if (now_ms() - last_progress > stall_ms) {
				fprintf(stderr, "printer stopped accepting data for %ld ms (sent %lld bytes)\n", stall_ms, total);
				return 3;
			}
		}
	}
	if (n < 0) { perror("read stdin"); return 4; }
	fprintf(stderr, "sent %lld bytes\n", total);
	return 0;
}

int main(int argc, char **argv)
{
	char vid[8] = "03f0", pid[8] = "2b17";
	long stall_ms = 120000;
	int opt;

	while ((opt = getopt(argc, argv, "d:t:")) != -1) {
		if (opt == 'd' && sscanf(optarg, "%4[0-9a-fA-F]:%4[0-9a-fA-F]", vid, pid) == 2) continue;
		if (opt == 't') { stall_ms = atol(optarg); continue; }
		fprintf(stderr, "usage: %s [-d VID:PID] [-t stall_ms] id|status|send|find\n", argv[0]);
		return 64;
	}
	if (optind >= argc) { fprintf(stderr, "missing command\n"); return 64; }
	const char *cmd = argv[optind];

	struct printer p;
	memset(&p, 0, sizeof p);
	if (find_printer(vid, pid, &p)) { fprintf(stderr, "printer %s:%s not found\n", vid, pid); return 2; }
	if (!strcmp(cmd, "find")) {
		printf("%s if=%d alt=%d out=0x%02x in=0x%02x\n", p.node, p.ifnum, p.alt, p.ep_out, p.ep_in);
		return 0;
	}

	int fd = open_claim(&p);
	if (fd < 0) return 4;
	int rc;
	if (!strcmp(cmd, "id")) rc = cmd_id(fd, &p);
	else if (!strcmp(cmd, "status")) rc = cmd_status(fd, &p);
	else if (!strcmp(cmd, "send")) rc = cmd_send(fd, &p, stall_ms);
	else { fprintf(stderr, "unknown command %s\n", cmd); rc = 64; }
	release_close(fd, &p);
	return rc;
}
