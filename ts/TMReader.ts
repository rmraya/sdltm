/*******************************************************************************
 * Copyright (c) 2022 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse   License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/
import { Buffer } from 'buffer';
import { appendFileSync, existsSync, unlinkSync } from 'fs';
import { Database } from "sqlite3";
import { Constants, DOMBuilder, Indenter, SAXParser, XMLAttribute, XMLDeclaration, XMLDocument, XMLElement, XMLNode } from 'typesxml';
import sqlite3 = require('sqlite3');

const SUCCESS: string = 'Success';
const ERROR: string = 'Error';

export class TMReader {

    db: Database;
    parser: SAXParser;
    contentHandler: DOMBuilder;
    productName: string = 'sdltm';
    version: string = '1.0.2';

    constructor(sdltm: string, tmx: string, options: any, callback: Function) {
        if (existsSync(tmx)) {
            unlinkSync(tmx);
        }
        if (options.productName) {
            this.productName = options.productName;
        }
        if (options.version) {
            this.version = options.version;
        }
        this.parser = new SAXParser();
        this.contentHandler = new DOMBuilder();
        this.parser.setContentHandler(this.contentHandler);
        this.openDatabase(sdltm, tmx, callback);
    }

    openDatabase(sdltm: string, tmx: string, callback: Function): void {
        this.db = new sqlite3.Database(sdltm, sqlite3.OPEN_READONLY, (error: Error) => {
            if (error) {
                callback({
                    'status': ERROR,
                    'reason': error.message
                })
                return;
            }
            this.getSourceLanguage(tmx, callback);
        });
    }

    getSourceLanguage(tmx: string, callback: Function): void {
        let srcLang: string = '';
        this.db.each(`SELECT source_language srcLang FROM translation_memories`, [],
            (error: Error, row: any) => {
                if (error) {
                    callback({
                        'status': ERROR,
                        'reason': error.message
                    })
                    return;
                }
                srcLang = row.srcLang;
            },
            (error: Error) => {
                if (error) {
                    callback({
                        'status': ERROR,
                        'reason': error.message
                    })
                    return;
                }
                let headerString: string = new XMLDeclaration('1.0', 'UTF-8').toString();
                headerString += '\n<tmx version="1.4">\n  '
                let header: XMLElement = new XMLElement('header');
                header.setAttribute(new XMLAttribute('creationtool', this.productName));
                header.setAttribute(new XMLAttribute('creationtoolversion', this.version));
                header.setAttribute(new XMLAttribute('o-tmf', 'SDLTM'));
                header.setAttribute(new XMLAttribute('adminlang', 'en-US'));
                header.setAttribute(new XMLAttribute('segtype', 'sentence'));
                header.setAttribute(new XMLAttribute('datatype', 'unknown'));
                header.setAttribute(new XMLAttribute('srclang', srcLang));
                headerString += header.toString();
                headerString += '\n  <body>\n';
                appendFileSync(tmx, headerString, 'utf8');
                this.parseDatabase(tmx, callback);
            });
    }

    closeDb(count: number, callback: Function): void {
        this.db.close((error: Error) => {
            if (error) {
                callback({
                    'status': ERROR,
                    'reason': error.message
                })
                return;
            }
            callback({
                'status': SUCCESS,
                'count': count
            });
        });
    }

    parseDatabase(tmx: string, callback: Function): void {
        let indenter: Indenter = new Indenter(2, 2);
        let sql: string = `SELECT id, source_segment source,  target_segment target, creation_date creation, creation_user creator, 
             change_date change FROM translation_units`;
        this.db.each(sql, [],
            (err: Error, row: any) => {
                if (err) {
                    throw err;
                }
                let source: XMLElement = this.toElement(row.source);
                let target: XMLElement = this.toElement(row.target);

                let tu: XMLElement = new XMLElement('tu');
                tu.setAttribute(new XMLAttribute('creationid', row.creator));
                tu.setAttribute(new XMLAttribute('creationdate', this.tmxDateString(row.creation)));
                let changeDate: string = this.tmxDateString(row.creation);
                if (changeDate !== '') {
                    tu.setAttribute(new XMLAttribute('changedate', changeDate));
                }

                let srcLang: string = source.getChild('CultureName').getText();
                let srcTuv: XMLElement = new XMLElement('tuv');
                srcTuv.setAttribute(new XMLAttribute('xml:lang', srcLang));
                tu.addElement(srcTuv);
                let srcSeg: XMLElement = new XMLElement('seg');
                srcSeg.setContent(this.parseContent(source.getChild('Elements')));
                srcTuv.addElement(srcSeg);

                let tgtLang: string = target.getChild('CultureName').getText();
                let tgtTuv: XMLElement = new XMLElement('tuv');
                tgtTuv.setAttribute(new XMLAttribute('xml:lang', tgtLang));
                tu.addElement(tgtTuv);
                let tgtSeg: XMLElement = new XMLElement('seg');
                tgtSeg.setContent(this.parseContent(target.getChild('Elements')));
                tgtTuv.addElement(tgtSeg);

                indenter.indent(tu);
                appendFileSync(tmx, Buffer.from('  ' + tu.toString() + '\n'), 'utf8');
            },
            (error: Error, count: number) => {
                if (error) {
                    return;
                }
                appendFileSync(tmx, '  </body>\n</tmx>', 'utf8');
                this.closeDb(count, callback);
            });
    }

    toElement(text: string): XMLElement {
        this.parser.parseString(text);
        let doc: XMLDocument = this.contentHandler.getDocument();
        return doc.getRoot();
    }

    parseContent(element: XMLElement): Array<XMLNode> {
        let result: XMLElement = new XMLElement('seg');
        let nodes: Array<XMLNode> = element.getContent();
        nodes.forEach((node: XMLNode) => {
            if (node.getNodeType() === Constants.ELEMENT_NODE) {
                let child: XMLElement = node as XMLElement;
                if ('Text' === child.getName()) {
                    result.addString(child.getChild('Value').getText());
                }
                if ('Tag' === child.getName()) {
                    let tagType: string = child.getChild('Type').getText();
                    if (tagType === 'Start') {
                        let bpt: XMLElement = new XMLElement('bpt');
                        bpt.setAttribute(new XMLAttribute('i', child.getChild('Anchor').getText()));
                        bpt.setAttribute(new XMLAttribute('x', child.getChild('AlignmentAnchor').getText()));
                        bpt.setAttribute(new XMLAttribute('type', child.getChild('TagID').getText()));
                        result.addElement(bpt);
                    } else if (tagType === 'End') {
                        let ept: XMLElement = new XMLElement('ept');
                        ept.setAttribute(new XMLAttribute('i', child.getChild('Anchor').getText()));
                        result.addElement(ept);
                    } else {
                        let ph: XMLElement = new XMLElement('ph');
                        ph.setAttribute(new XMLAttribute('x', child.getChild('AlignmentAnchor').getText()));
                        ph.setAttribute(new XMLAttribute('type', child.getChild('TagID').getText()));
                        result.addElement(ph);
                    }
                }
            }
        });
        return result.getContent();
    }

    tmxDateString(date: string): string {
        while (date.indexOf('-') != -1) {
            date = date.replace('-', '');
        }
        while (date.indexOf(':') != -1) {
            date = date.replace(':', '');
        }
        return date.replace(' ', 'T') + 'Z';
    }
}