/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Node-only drivers stay out of the bundle.
    serverComponentsExternalPackages: ["mssql", "tedious", "exceljs"],
  },
};
export default nextConfig;
