-- Add advanced print settings columns to print_jobs
ALTER TABLE print_jobs 
ADD COLUMN is_collated boolean DEFAULT true,
ADD COLUMN pages_per_sheet integer DEFAULT 1,
ADD COLUMN page_order varchar DEFAULT 'horizontal',
ADD COLUMN border boolean DEFAULT false,
ADD COLUMN quality varchar DEFAULT 'standard',
ADD COLUMN fit_scale varchar DEFAULT 'fit';
