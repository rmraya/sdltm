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

import { appendFileSync, existsSync, unlinkSync } from 'fs';
import sqlite3, { Database } from 'sqlite3';
import { Constants, DOMBuilder, Indenter, SAXParser, XMLAttribute, XMLDeclaration, XMLDocument, XMLElement, XMLNode, XMLUtils } from 'typesxml';

const SUCCESS: string = 'Success';
const ERROR: string = 'Error';

export type TMReaderCallback = (result: { status: typeof SUCCESS; count: number } | { status: typeof ERROR; reason: string }) => void;

export class TMReader {

    db: Database;
    parser: SAXParser;
    contentHandler: DOMBuilder;
    productName: string = 'sdltm';
    version: string = '1.7.0';

    tmx: string;
    header: XMLElement;

    constructor(sdltm: string, tmx: string, options: { productName?: string; version?: string }, callback: TMReaderCallback) {
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
        this.db = new sqlite3.Database(sdltm, sqlite3.OPEN_READONLY, (error: Error | null) => {
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

    getHeaderAttributes(callback: TMReaderCallback): void {
        this.db.each(`SELECT source_language, creation_user, creation_date FROM translation_memories`, [],
            // callback
            (error: Error | null, row: any) => {
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
            (error: Error | null) => {
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

    getHeaderProperties(callback: TMReaderCallback): void {
        let propertiesMap: Map<string, XMLElement> = new Map<string, XMLElement>();
        this.db.each('SELECT attributes.name, attributes.type, picklist_values.value FROM attributes  ' +
            'INNER JOIN  picklist_values  ON  picklist_values.attribute_id = attributes.id  ORDER BY  name;', [],
            // callback
            (error: Error | null, row: any) => {
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
                    let prop: XMLElement | undefined = propertiesMap.get(row.name);
                    if (prop) {
                        if (prop.getText() !== '') {
                            prop.addString(',');
                        }
                        prop.addString(row.value);
                    }
                }
            },
            // complete all properties
            (error: Error | null) => {
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

    writeHeader(callback: TMReaderCallback): void {
        let indenter: Indenter = new Indenter(2, 2);
        indenter.indent(this.header);
        let headerString: string = new XMLDeclaration('1.0', 'UTF-8').toString();
        headerString += '\n<tmx version="1.4">\n  '
        headerString += this.header.toString();
        headerString += '\n  <body>\n';
        appendFileSync(this.tmx, headerString, 'utf8');
        this.parseDatabase(callback);
    }

    closeDb(count: number, callback: TMReaderCallback): void {
        this.db.close((error: Error | null) => {
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

    parseDatabase(callback: TMReaderCallback): void {
        let indenter: Indenter = new Indenter(2, 2);
        let sql: string = `SELECT id, source_segment, target_segment, creation_date, creation_user, change_date, change_user, last_used_date, last_used_user, usage_counter FROM translation_units`;
        this.db.each(sql, [],
            (err: Error | null, row: any) => {
                if (err) {
                    callback({
                        'status': ERROR,
                        'reason': err.message
                    });
                    return;
                }
                let source: XMLElement | undefined = this.toElement(row.source_segment);
                if (!source) {
                    callback({
                        'status': ERROR,
                        'reason': 'Cannot parse source segment'
                    });
                    return;
                }
                let target: XMLElement | undefined = this.toElement(row.target_segment);
                if (!target) {
                    callback({
                        'status': ERROR,
                        'reason': 'Cannot parse target segment'
                    });
                    return;
                }

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
                let cultureName: XMLElement | undefined = source.getChild('CultureName');
                if (!cultureName) {
                    callback({
                        'status': ERROR,
                        'reason': 'Source segment without CultureName child'
                    });
                    return;
                }
                let srcLang: string = cultureName.getText();
                let srcTuv: XMLElement = new XMLElement('tuv');
                srcTuv.setAttribute(new XMLAttribute('xml:lang', srcLang));
                tu.addElement(srcTuv);
                let srcSeg: XMLElement = new XMLElement('seg');
                let elements: XMLElement | undefined = source.getChild('Elements');
                if (!elements) {
                    callback({
                        'status': ERROR,
                        'reason': 'Source segment without Elements child'
                    });
                    return;
                }
                srcSeg.setContent(this.parseContent(elements));
                srcTuv.addElement(srcSeg);

                cultureName = target.getChild('CultureName');
                if (!cultureName) {
                    callback({
                        'status': ERROR,
                        'reason': 'Target segment without CultureName child'
                    });
                    return;
                }
                let tgtLang: string = cultureName.getText();
                let tgtTuv: XMLElement = new XMLElement('tuv');
                tgtTuv.setAttribute(new XMLAttribute('xml:lang', tgtLang));
                tu.addElement(tgtTuv);
                let tgtSeg: XMLElement = new XMLElement('seg');
                elements = target.getChild('Elements');
                if (!elements) {
                    callback({
                        'status': ERROR,
                        'reason': 'Target segment without Elements child'
                    });
                    return;
                }
                tgtSeg.setContent(this.parseContent(elements));
                tgtTuv.addElement(tgtSeg);

                indenter.indent(tu);
                appendFileSync(this.tmx, '  ' + tu.toString() + '\n', 'utf8');
            },
            (error: Error | null, count: number) => {
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

    toElement(text: string): XMLElement | undefined {
        this.parser.parseString(XMLUtils.validXml10Chars(text));
        let doc: XMLDocument | undefined = this.contentHandler.getDocument();
        return doc ? doc.getRoot() : undefined;
    }

    parseContent(element: XMLElement): Array<XMLNode> {
        let result: XMLElement = new XMLElement('seg');
        let nodes: Array<XMLNode> = element.getContent();
        nodes.forEach((node: XMLNode) => {
            if (node.getNodeType() === Constants.ELEMENT_NODE) {
                let child: XMLElement = node as XMLElement;
                if ('Text' === child.getName()) {
                    let value: XMLElement | undefined = child.getChild('Value');
                    if (!value) {
                        throw new Error('Text element without Value child');
                    }
                    result.addString(value.getText());
                }
                if ('Tag' === child.getName()) {
                    let type: XMLElement | undefined = child.getChild('Type');
                    if (!type) {
                        throw new Error('Tag element without Type child');
                    }
                    let tagType: string = type.getText();
                    if (tagType === 'Start') {
                        let anchor: XMLElement | undefined = child.getChild('Anchor');
                        if (!anchor) {
                            throw new Error('Start Tag element without Anchor child');
                        }
                        let alignmentAnchor: XMLElement | undefined = child.getChild('AlignmentAnchor');
                        if (!alignmentAnchor) {
                            throw new Error('Start Tag element without AlignmentAnchor child');
                        }
                        let tagIdD: XMLElement | undefined = child.getChild('TagID');
                        if (!tagIdD) {
                            throw new Error('Start Tag element without TagID child');
                        }
                        let bpt: XMLElement = new XMLElement('bpt');
                        bpt.setAttribute(new XMLAttribute('i', anchor.getText()));
                        bpt.setAttribute(new XMLAttribute('x', alignmentAnchor.getText()));
                        bpt.setAttribute(new XMLAttribute('type', tagIdD.getText()));
                        result.addElement(bpt);
                    } else if (tagType === 'End') {
                        let anchor: XMLElement | undefined = child.getChild('Anchor');
                        if (!anchor) {
                            throw new Error('End Tag element without Anchor child');
                        }
                        let ept: XMLElement = new XMLElement('ept');
                        ept.setAttribute(new XMLAttribute('i', anchor.getText()));
                        result.addElement(ept);
                    } else {
                        let alignmentAnchor: XMLElement | undefined = child.getChild('AlignmentAnchor');
                        if (!alignmentAnchor) {
                            throw new Error('Standalone Tag element without AlignmentAnchor child');
                        }
                        let tagIdD: XMLElement | undefined = child.getChild('TagID');
                        if (!tagIdD) {
                            throw new Error('Standalone Tag element without TagID child');
                        }
                        let ph: XMLElement = new XMLElement('ph');
                        ph.setAttribute(new XMLAttribute('x', alignmentAnchor.getText()));
                        ph.setAttribute(new XMLAttribute('type', tagIdD.getText()));
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