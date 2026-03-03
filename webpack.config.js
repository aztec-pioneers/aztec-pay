import { createRequire } from 'module';
import webpack from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import Dotenv from 'dotenv-webpack';

const require = createRequire(import.meta.url);

export default (_, argv) => ({
  entry: {
    main: './app/main.ts',
    claim: './app/claim.ts',
  },
  target: 'web',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: {
          allowTsInNodeModules: true,
          transpileOnly: true,
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './app/index.html',
      filename: 'index.html',
      chunks: ['main'],
      scriptLoading: 'module',
    }),
    new HtmlWebpackPlugin({
      template: './app/claim.html',
      filename: 'claim.html',
      chunks: ['claim'],
      scriptLoading: 'module',
    }),
    new Dotenv({ path: './.env', systemvars: true }), // systemvars: true allows env vars to override .env
    // DefinePlugin not needed for AZTEC_* vars — Dotenv with systemvars handles them
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
  ],
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      tty: false,
      path: false,
      net: false,
      crypto: false,
      util: require.resolve('util/'),
      assert: require.resolve('assert/'),
      buffer: require.resolve('buffer/'),
    },
  },
  devServer: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    client: {
      overlay: false,
    },
    historyApiFallback: {
      rewrites: [
        { from: /^\/claim/, to: '/claim.html' },
        { from: /./, to: '/index.html' },
      ],
    },
    proxy: [
      {
        context: ['/api'],
        target: process.env.API_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    ],
  },
});
