import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const reportPath = path.join(web, 'test-results/e11-demo-results.json');
const output = path.join(web, 'test-results/e11-demo/e11-project-demonstration.mp4');

function recordedVideos(suite) {
  const recordings = (suite.specs ?? []).flatMap((spec) =>
    spec.tests.flatMap((test) =>
      test.results.flatMap((result) =>
        result.attachments.filter((attachment) => attachment.contentType === 'video/webm'),
      ),
    ),
  );
  return [...recordings, ...(suite.suites ?? []).flatMap(recordedVideos)];
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const videos = report.suites
  .flatMap(recordedVideos)
  .map((attachment) => path.resolve(web, attachment.path));
if (videos.length === 0) {
  process.stdout.write(
    'No browser videos to export; API-only results remain in the HTML report.\n',
  );
} else {
  const results = path.join(web, 'test-results/e11-demo') + path.sep;
  if (videos.some((video) => !video.startsWith(results) || !existsSync(video))) {
    throw new Error(
      'The report must reference existing videos inside the E11 test-results directory',
    );
  }
  const filters = videos.map(
    (_, index) =>
      `[${index}:v]fps=25,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v${index}]`,
  );
  filters.push(
    `${videos.map((_, index) => `[v${index}]`).join('')}concat=n=${videos.length}:v=1:a=0[out]`,
  );
  const converted = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...videos.flatMap((video) => ['-i', video]),
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      output,
    ],
    { stdio: 'inherit' },
  );
  if (converted.error?.code === 'ENOENT') {
    process.stdout.write(
      'Install ffmpeg to export MP4; the original WebM videos are playable in the HTML report.\n',
    );
  } else if (converted.error || converted.status !== 0) {
    process.stderr.write('MP4 export failed; original WebM videos remain in the HTML report.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(`Exported ${videos.length} browser recordings to ${output}\n`);
  }
}
