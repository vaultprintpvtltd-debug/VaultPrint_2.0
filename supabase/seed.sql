-- ─── PRICING CONFIG — A4 ONLY ─────────────────────────────────────────────────
-- 4 tiers: BW single, BW duplex, Colour single, Colour duplex
-- All A4. Edit prices from the admin panel after launch.

INSERT INTO pricing_config (color_mode, paper_size, duplex, price_per_page) VALUES
  ('bw',     'A4', false, 2.00),
  ('bw',     'A4', true,  1.50),
  ('colour', 'A4', false, 5.00),
  ('colour', 'A4', true,  4.00);