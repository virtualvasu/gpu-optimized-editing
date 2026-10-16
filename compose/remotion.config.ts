// Studio, stills and `remotion bundle` (vep). Full renders go through render-job.mjs, which sets its own encoding options.
import { Config } from '@remotion/cli/config';
import override from './webpack-override.cjs';
Config.setConcurrency(6);
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(override);
