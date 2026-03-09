const { src, dest, series } = require('gulp');
const path = require('path');

function buildIcons() {
  return src('nodes/**/*.{png,svg}')
    .pipe(dest('dist/nodes'));
}

exports['build:icons'] = buildIcons;
exports.default = series(buildIcons);
