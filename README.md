# sdltm

TypeScript library for converting SDLTM files (Translation Memory databases from Trados Studio) to TMX 1.4b

## Installation

`npm install sdltm`

## Example

```TypeScript
import { TMReader } from "sdltm";

const SUCCESS: string = 'Success';
const ERROR: string = 'Error';

class Test {

    constructor(sdltmFile: string, tmxFile: string) {
        new TMReader(sdltmFile, tmxFile, { 'productName': "My Tool", 'version': '1.0' }, (data: any) => {
            if (data.status === SUCCESS) {
                console.log(JSON.stringify(data));
            }
            if (data.status === ERROR) {
                console.error(data.reason);
            }
        });
    }
}

new Test('Japanese.sdltm', 'Japanese.tmx');
```
