# sdltm

TypeScript library for converting SDLTM files (Translation Memory databases from Trados Studio) to TMX 1.4b

## Installation

`npm install sdltm`

## Example

```TypeScript
import { TMReader } from 'sdltm';

class Test {

    constructor() {
        try {
            new TMReader('Sample.sdltm', 'Output.tmx');            
        } catch (e) {
            console.log(e.message)
        }
    }
}

new Test();
```
