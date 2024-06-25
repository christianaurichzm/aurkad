const path = require('path');
const Dotenv = require('dotenv-webpack');

module.exports = {
    entry: './src/client/client.ts',
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.client.json'
                    }
                },
                exclude: /node_modules/,
            },
        ],
    },
    plugins: [
        new Dotenv({
          path: `./.env.${process.env.NODE_ENV}`,
        }),
      ],
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public'),
        publicPath: '/'
    },
    mode: 'production',
    optimization: {
        minimize: true,
    },
};
