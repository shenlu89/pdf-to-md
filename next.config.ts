import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  webpack: (config, { isServer }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config.resolve.alias as any) = {
      ...config.resolve.alias,
      "pdfjs-dist/build/pdf.worker.js": false,
    };
    return config;
  },
  experimental: {
    serverActions: { bodySizeLimit: "52mb" },
  },
};

export default nextConfig;
