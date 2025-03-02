/*******************************************************************************
 * Copyright (c) 2022 - 2025 Maxprograms.
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
import { Constants, DOMBuilder, Indenter, SAXParser, XMLAttribute, XMLDeclaration, XMLDocument, XMLElement, XMLNode, XMLUtils } from 'typesxml';
import sqlite3 = require('sqlite3');

const SUCCESS: string = 'Success';
const ERROR: string = 'Error';

export class TMReader {

    db: Database;
    parser: SAXParser;
    contentHandler: DOMBuilder;
    productName: string = 'sdltm';
    version: string = '1.4.0';

    tmx: string;
    header: XMLElement;

    constructor(sdltm: string, tmx: string, options: any, callback: Function) {
        if (existsSync(tmx)) {
            unlinkSync(tmx);
        }
        this.tmx = tmx;
        if (options.productName) {
            this.productName = options.productName;
        }
        if (options.version) {
            this.version = options.version;
        }
        this.header = new XMLElement('header');
        this.header.setAttribute(new XMLAttribute('creationtool', this.productName));
        this.header.setAttribute(new XMLAttribute('creationtoolversion', this.version));
        this.header.setAttribute(new XMLAttribute('o-tmf', 'SDLTM'));
        this.header.setAttribute(new XMLAttribute('adminlang', 'en-US'));
        this.header.setAttribute(new XMLAttribute('segtype', 'sentence'));
        this.header.setAttribute(new XMLAttribute('datatype', 'unknown'));
        this.parser = new SAXParser();
        this.contentHandler = new DOMBuilder();
        this.parser.setContentHandler(this.contentHandler);
        this.openDatabase(sdltm, callback);
    }

    openDatabase(sdltm: string, callback: Function): void {
        this.db = new sqlite3.Database(sdltm, sqlite3.OPEN_READONLY, (error: Error) => {
            if (error) {
                callback({
                    'status': ERROR,
                    'reason': error.message
                });
                return;
            }
            this.getHeaderAttributes(callback);
        });
    }

    getHeaderAttributes(callback: Function): void {
        this.db.each(`SELECT source_language, creation_user, creation_date FROM translation_memories`, [],
            // callback
            (error: Error, row: any) => {
                if (error) {
                    callback({
                        'status': ERROR,
                        'reason': error.message
                    });
                    return;
                }
                this.header.setAttribute(new XMLAttribute('srclang', row.source_language));
                this.header.setAttribute(new XMLAttribute('creationdate', this.tmxDateString(row.creation_date)));
                this.header.setAttribute(new XMLAttribute('creationid', row.creation_user));
            },
            // complete
            (error: Error) => {
                if (error) {
                    callback({
                        'status': ERROR,
                        'reason': error.message
                    });
                    return;
                }
                this.getHeaderProperties(callback);
            }
        );
    }

    getHeaderProperties(callback: Function) {
        let propertiesMap: Map<string, XMLElement> = new Map<string, XMLElement>();
        this.db.each('SELECT attributes.name, attributes.type, picklist_values.value FROM attributes  ' +
            'INNER JOIN  picklist_values  ON  picklist_values.attribute_id = attributes.id  ORDER BY  name;', [],
            // callback
            (error: Error, row: any) => {
                if (error) {
                    callback({
                        'status': ERROR,
                        'reason': error.message
                    });
                    return;
                }
                if (row.type === 5) {
                    if (!propertiesMap.has(row.name)) {
                        let prop: XMLElement = new XMLElement('prop');
                        let propertyType: string = 'x-' + row.name + ':MultplePicklist';
                        prop.setAttribute(new XMLAttribute('type', propertyType));
                        this.header.addElement(prop);
                        propertiesMap.set(row.name, prop);
                    }
                    let prop: XMLElement = propertiesMap.get(row.name);
                    if (prop.getText() !== '') {
                        prop.addString(',');
                    }
                    prop.addString(row.value);
                }
            },
            // complete all properties
            (error: Error) => {
                if (error) {
                    callback({
                        'status': ERROR,
                        'reason': error.message
                    });
                    return;
                }
                this.writeHeader(callback);
            }
        );
    }

    writeHeader(callback: Function): void {
        let indenter: Indenter = new Indenter(2, 2);
        indenter.indent(this.header);
        let headerString: string = new XMLDeclaration('1.0', 'UTF-8').toString();
        headerString += '\n<tmx version="1.4">\n  '
        headerString += this.header.toString();
        headerString += '\n  <body>\n';
        appendFileSync(this.tmx, headerString, 'utf8');
        this.parseDatabase(callback);
    }

    closeDb(count: number, callback: Function): void {
        this.db.close((error: Error) => {
            if (error) {
                callback({
                    'status': ERROR,
                    'reason': error.message
                });
                return;
            }
            callback({
                'status': SUCCESS,
                'count': count
            });
        });
    }

    parseDatabase(callback: Function): void {
        let indenter: Indenter = new Indenter(2, 2);
        let sql: string = `SELECT id, source_segment, target_segment, creation_date, creation_user, change_date, change_user, last_used_date, last_used_user, usage_counter FROM translation_units`;
        this.db.each(sql, [],
            (err: Error, row: any) => {
                if (err) {
                    throw err;
                }
                let source: XMLElement = this.toElement(row.source_segment);
                let target: XMLElement = this.toElement(row.target_segment);

                let tu: XMLElement = new XMLElement('tu');
                tu.setAttribute(new XMLAttribute('creationid', row.creation_user));
                tu.setAttribute(new XMLAttribute('creationdate', this.tmxDateString(row.creation_date)));
                let changeDate: string = this.tmxDateString(row.change_date);
                if (changeDate !== '') {
                    tu.setAttribute(new XMLAttribute('changedate', changeDate));
                }
                let changeUser: string = row.change_user;
                if (changeUser !== '') {
                    tu.setAttribute(new XMLAttribute('changeid', changeUser));
                }
                let lastUsedDate: string = row.last_used_date;
                if (lastUsedDate !== '') {
                    tu.setAttribute(new XMLAttribute('lastusagedate', this.tmxDateString(lastUsedDate)));
                }
                let lastUsedUser: string = row.last_used_user;
                if (lastUsedUser !== '') {
                    let prop: XMLElement = new XMLElement('prop');
                    prop.setAttribute(new XMLAttribute('type', 'x-LastUsedBy'));
                    prop.addString(lastUsedUser);
                    tu.addElement(prop);
                }
                let usageCount: string = row.usage_counter;
                if (usageCount && usageCount !== '0') {
                    tu.setAttribute(new XMLAttribute('usagecount', usageCount));
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
                appendFileSync(this.tmx, Buffer.from('  ' + tu.toString() + '\n'), 'utf8');
            },
            (error: Error, count: number) => {
                if (error) {
                    callback({
                        'status': ERROR,
                        'reason': error.message
                    });
                    return;
                }
                appendFileSync(this.tmx, '  </body>\n</tmx>', 'utf8');
                this.closeDb(count, callback);
            });
    }

    toElement(text: string): XMLElement {
        this.parser.parseString(XMLUtils.validXml10Chars(text));
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