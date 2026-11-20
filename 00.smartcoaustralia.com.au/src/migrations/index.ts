import * as migration_20261118_091725 from './20261118_091725';
import * as migration_20261118_095558 from './20261118_095558';
import * as migration_20261118_110246_collections from './20261118_110246_collections';
import * as migration_20261118_133908 from './20261118_133908';
import * as migration_20261118_150818 from './20261118_150818';
import * as migration_20261118_162543_capabilities_page from './20261118_162543_capabilities_page';
import * as migration_20261118_164608_process_page from './20261118_164608_process_page';
import * as migration_20261118_170328_quality_page from './20261118_170328_quality_page';
import * as migration_20261118_172735_projects_page from './20261118_172735_projects_page';
import * as migration_20261118_183209_products_page from './20261118_183209_products_page';
import * as migration_20261118_192456_team_page from './20261118_192456_team_page';
import * as migration_20261118_195656_inquiries from './20261118_195656_inquiries';
import * as migration_20261118_205152_contact_page from './20261118_205152_contact_page';
import * as migration_20261118_215029_privacy_page from './20261118_215029_privacy_page';
import * as migration_20261118_222112_seo_meta from './20261118_222112_seo_meta';
import * as migration_20261119_013246_header_topstrip from './20261119_013246_header_topstrip';
import * as migration_20261119_015854_project_detail from './20261119_015854_project_detail';
import * as migration_20261119_024052_project_card_fields from './20261119_024052_project_card_fields';
import * as migration_20261119_101215_section_visibility from './20261119_101215_section_visibility';

export const migrations = [
  {
    up: migration_20261118_091725.up,
    down: migration_20261118_091725.down,
    name: '20261118_091725',
  },
  {
    up: migration_20261118_095558.up,
    down: migration_20261118_095558.down,
    name: '20261118_095558',
  },
  {
    up: migration_20261118_110246_collections.up,
    down: migration_20261118_110246_collections.down,
    name: '20261118_110246_collections',
  },
  {
    up: migration_20261118_133908.up,
    down: migration_20261118_133908.down,
    name: '20261118_133908',
  },
  {
    up: migration_20261118_150818.up,
    down: migration_20261118_150818.down,
    name: '20261118_150818',
  },
  {
    up: migration_20261118_162543_capabilities_page.up,
    down: migration_20261118_162543_capabilities_page.down,
    name: '20261118_162543_capabilities_page',
  },
  {
    up: migration_20261118_164608_process_page.up,
    down: migration_20261118_164608_process_page.down,
    name: '20261118_164608_process_page',
  },
  {
    up: migration_20261118_170328_quality_page.up,
    down: migration_20261118_170328_quality_page.down,
    name: '20261118_170328_quality_page',
  },
  {
    up: migration_20261118_172735_projects_page.up,
    down: migration_20261118_172735_projects_page.down,
    name: '20261118_172735_projects_page',
  },
  {
    up: migration_20261118_183209_products_page.up,
    down: migration_20261118_183209_products_page.down,
    name: '20261118_183209_products_page',
  },
  {
    up: migration_20261118_192456_team_page.up,
    down: migration_20261118_192456_team_page.down,
    name: '20261118_192456_team_page',
  },
  {
    up: migration_20261118_195656_inquiries.up,
    down: migration_20261118_195656_inquiries.down,
    name: '20261118_195656_inquiries',
  },
  {
    up: migration_20261118_205152_contact_page.up,
    down: migration_20261118_205152_contact_page.down,
    name: '20261118_205152_contact_page',
  },
  {
    up: migration_20261118_215029_privacy_page.up,
    down: migration_20261118_215029_privacy_page.down,
    name: '20261118_215029_privacy_page',
  },
  {
    up: migration_20261118_222112_seo_meta.up,
    down: migration_20261118_222112_seo_meta.down,
    name: '20261118_222112_seo_meta',
  },
  {
    up: migration_20261119_013246_header_topstrip.up,
    down: migration_20261119_013246_header_topstrip.down,
    name: '20261119_013246_header_topstrip',
  },
  {
    up: migration_20261119_015854_project_detail.up,
    down: migration_20261119_015854_project_detail.down,
    name: '20261119_015854_project_detail',
  },
  {
    up: migration_20261119_024052_project_card_fields.up,
    down: migration_20261119_024052_project_card_fields.down,
    name: '20261119_024052_project_card_fields',
  },
  {
    up: migration_20261119_101215_section_visibility.up,
    down: migration_20261119_101215_section_visibility.down,
    name: '20261119_101215_section_visibility'
  },
];
