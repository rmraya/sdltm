# sdltm

TypeScript library for converting SDLTM files (Translation Memory databases from Trados Studio) to TMX 1.4b

## Installation

`npm install sdltm`

## Requirements

- Node.js 20.11+ (or any release that ships the `node:sqlite` experimental module)
- SQLite-compatible `.sdltm` files created by SDL/Trados Studio

## Usage

### Promise handling

```TypeScript
import { TMReader, TMReaderResult } from 'sdltm';

function convertWithPromise(): void {
    const reader: TMReader = new TMReader({ productName: 'My Tool', version: '2.0.0' });
    reader.convert('Japanese.sdltm', 'Japanese.tmx').then((result: TMReaderResult) => {
        console.log(`Conversion completed with status: ${result.status}, total TUs: ${result.count}`);
    }).catch((error: unknown) => {
        const message: string = error instanceof Error ? error.message : String(error);
        console.error('Conversion failed:', message);
    });
}

convertWithPromise();
```

### Async/await

```TypeScript
import { TMReader, TMReaderResult } from 'sdltm';

async function convertWithAsyncAwait(): Promise<void> {
    const reader: TMReader = new TMReader({ productName: 'My Tool', version: '2.0.0' });
    try {
        const result: TMReaderResult = await reader.convert('Japanese.sdltm', 'Japanese.tmx');
        console.log(`Conversion completed with status: ${result.status}, total TUs: ${result.count}`);
    } catch (error: unknown) {
        const message: string = error instanceof Error ? error.message : String(error);
        console.error('Conversion failed:', message);
    }
}

convertWithAsyncAwait();
```

### Notes

- `productName` and `version` can be omitted; when they are, `TMReader` falls back to the values declared in the package’s own `package.json`.
- `convert()` returns a promise and automatically closes the SDLTM database connection when the process finishes or fails.
- The Node.js `node:sqlite` module currently logs an experimental warning; this is expected until the API is stabilized upstream.
