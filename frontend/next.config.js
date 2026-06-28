// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: path.join(__dirname, ".."),
};

module.exports = nextConfig;
