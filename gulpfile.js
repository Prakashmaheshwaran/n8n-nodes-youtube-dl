const path = require('path');
const { task, src, dest } = require('gulp');

task('build:icons', () => {
  const nodeSource = path.resolve('nodes');
  const nodeDestination = path.resolve('dist', 'nodes');

  return src([`${nodeSource}/**/*.svg`]).pipe(dest(nodeDestination));
});
