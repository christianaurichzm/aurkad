const path = require('path');

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
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public'),
        publicPath: '/'
    },
    mode: 'development',
    devServer: {
        static: path.join(__dirname, 'public'),
        hot: true,
        port: 3000,
        proxy: {
            '/api': 'http://localhost:8080'
        }
    },
    optimization: {
        minimize: false,
    },
};
