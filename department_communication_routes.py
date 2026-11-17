import os, uuid, shutil, io, re, zipfile, tempfile, json
from datetime import datetime
from xml.etree import ElementTree
from flask import Blueprint, jsonify, request, current_app, send_from_directory, send_file, abort, redirect, url_for, render_template_string
from werkzeug.utils import secure_filename
from extensions import db
from models.department_communication import DepartmentMessage, DepartmentSharedDocument, AccountsDispensingDocument
from models.secretariate import SecretariateDocument
from models.procurement import ProcurementDocument
from routes.office_helper_routes import require_roles, session_user, upload_folder, ALLOWED_EXTENSIONS, json_error

communication_bp=Blueprint('department_communication', __name__, url_prefix='/api/department-communication')
ROLES={'admin','system_admin','hospital_manager','accounts_officer','accountant','accounts','finance','finance_officer','procurement_officer'}
DEPARTMENTS={'hospital_administration','accounts','procurement'}
ROLE_DEPARTMENT={'admin':'hospital_administration','system_admin':'hospital_administration','hospital_manager':'hospital_administration','accounts_officer':'accounts','accountant':'accounts','accounts':'accounts','finance':'accounts','finance_officer':'accounts','procurement_officer':'procurement'}
def active_department():
    role=str(getattr(request,'office_role','') or '').strip().lower()
    return ROLE_DEPARTMENT.get(role, 'hospital_administration' if role in ('admin','hospital_manager') else '')


def _document_text(source_path, extension):
    """Extract the readable text used to make a PDF forwarding copy."""
    ext = (extension or '').lower()
    if ext == '.txt':
        with open(source_path, 'r', encoding='utf-8', errors='replace') as stream:
            return stream.read()
    if ext == '.rtf':
        with open(source_path, 'r', encoding='utf-8', errors='replace') as stream:
            raw = stream.read()
        return re.sub(r'\\[a-zA-Z]+-?\\d* ?|[{}]', '', raw).replace('\\par', '\n')
    if ext in {'.docx', '.odt', '.xlsx', '.ods'}:
        try:
            with zipfile.ZipFile(source_path) as archive:
                member = 'word/document.xml' if ext == '.docx' else 'content.xml'
                if ext == '.xlsx':
                    xml_members = [name for name in archive.namelist() if name.startswith('xl/worksheets/') and name.endswith('.xml')]
                    shared = ''
                    if 'xl/sharedStrings.xml' in archive.namelist():
                        shared = archive.read('xl/sharedStrings.xml').decode('utf-8', errors='replace')
                    return '\n'.join(_xml_text(shared) for _ in [0]) + '\n' + '\n'.join(_xml_text(archive.read(name).decode('utf-8', errors='replace')) for name in xml_members)
                return _xml_text(archive.read(member).decode('utf-8', errors='replace'))
        except (KeyError, zipfile.BadZipFile) as exc:
            raise ValueError('The selected file could not be read for PDF conversion.') from exc
    raise ValueError('PDF conversion supports PDF, images, text, RTF, DOCX, ODT, XLSX and ODS files. Save legacy .doc or .xls files as DOCX/XLSX or PDF first.')


def _xml_text(raw):
    try:
        root = ElementTree.fromstring(raw)
        text = ' '.join(part.strip() for part in root.itertext() if part and part.strip())
    except ElementTree.ParseError:
        text = re.sub(r'<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', text).strip()


def _create_text_pdf(destination, title, content):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.enums import TA_LEFT
    except ImportError:
        # Keep forwarding usable on small installations where optional PDF
        # libraries have not yet been installed. This deliberately simple
        # writer covers text/template documents; PDFs and images follow their
        # normal copy/conversion paths above.
        return _create_basic_pdf(destination, title, content)
    styles = getSampleStyleSheet()
    styles['BodyText'].alignment = TA_LEFT
    story = [Paragraph(str(title or 'Forwarded document'), styles['Title']), Spacer(1, 6 * mm)]
    lines = str(content or 'No document content was recorded.').splitlines() or ['No document content was recorded.']
    for line in lines:
        story.append(Paragraph((line or ' ').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'), styles['BodyText']))
        story.append(Spacer(1, 2 * mm))
    SimpleDocTemplate(destination, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm).build(story)


def _secretariate_document_text(document):
    """Turn a saved Secretariat record into its finished document layout.

    Secretariat template documents are stored as JSON so the Document Store can
    render a formal view.  Passing that JSON directly to ``str`` during
    forwarding produced a quoted Python dictionary in the attachment instead
    of the document the user created.
    """
    content = getattr(document, 'content', None) or {}
    if isinstance(content, str):
        try:
            import json
            content = json.loads(content)
        except (TypeError, ValueError):
            content = {'body': content}
    if not isinstance(content, dict):
        return str(content)

    def value(key):
        item = content.get(key, '')
        return str(item).strip() if item is not None else ''

    type_name = value('type_title') or getattr(document, 'document_type', '') or 'Secretariate Document'
    subject = value('subject') or getattr(document, 'title', '') or type_name
    document_date = value('date') or str(getattr(document, 'document_date', '') or '')
    reference = value('number')
    recipient = value('recipient')
    author = value('author')
    organization = value('organization') or 'HOSPITALSAVVY'
    lines = [organization.upper(), type_name.upper(), subject, '']
    for label, item in (
        ('Reference', reference), ('Date', document_date), ('To / Audience', recipient),
        ('Prepared by', author),
    ):
        if item:
            lines.extend([f'{label}: {item}', ''])

    specific = content.get('specific')
    if isinstance(specific, dict):
        labels = {
            'meeting_date': 'Meeting date', 'venue': 'Venue / platform',
            'chairperson': 'Chairperson', 'secretary': 'Minute taker',
            'attendance': 'Present / apologies', 'letter_type': 'Letter type',
            'from': 'From', 'cc': 'Copy to', 'deadline': 'Action deadline',
        }
        for key, item in specific.items():
            item = str(item or '').strip()
            if item and key not in ('salutation', 'closing'):
                label = labels.get(key, key.replace('_', ' ').title())
                lines.extend([f'{label}: {item}', ''])

    salutation = str((specific or {}).get('salutation', '') or '').strip() if isinstance(specific, dict) else ''
    if salutation:
        lines.extend([salutation, ''])
    body = value('body')
    if body:
        lines.extend([body, ''])
    closing = str((specific or {}).get('closing', '') or '').strip() if isinstance(specific, dict) else ''
    if closing:
        lines.extend([closing, ''])
    for label, item in (
        ('Recommendations / conclusion', value('actions')),
        ('Distribution / attachments', value('attachments')),
        ('Approved / signed by', value('approver')),
    ):
        if item:
            lines.extend([label + ':', item, ''])
    return '\n'.join(lines).strip() or subject


def _procurement_document_text(document):
    """Return readable content for a database-backed Procurement document."""
    payload = getattr(document, 'payload', None)
    if isinstance(payload, str):
        try: payload = json.loads(payload)
        except (TypeError, ValueError): payload = {'description': payload}
    if not isinstance(payload, dict): payload = {}
    lines = [
        str(getattr(document, 'document_type_display', None) or getattr(document, 'document_type', None) or 'Procurement Document').upper(),
        str(getattr(document, 'title', None) or 'Procurement Document'),
        '',
        f"Document number: {getattr(document, 'document_number', None) or payload.get('document_number') or '—'}",
        f"Date: {getattr(document, 'document_date', None) or payload.get('document_date') or '—'}",
        f"Party: {getattr(document, 'party_name', None) or payload.get('party_name') or payload.get('party') or '—'}",
        f"Department: {getattr(document, 'department', None) or payload.get('department') or '—'}",
        f"Status: {getattr(document, 'status', None) or payload.get('status') or '—'}",
        '',
    ]
    labels = {
        'description': 'Description', 'reference': 'Reference', 'terms': 'Terms',
        'party_contact': 'Party contact', 'party_address': 'Party address',
        'organization_name': 'Organization', 'organization_address': 'Organization address',
        'organization_phone': 'Organization phone', 'organization_email': 'Organization email',
        'subtotal': 'Subtotal', 'tax': 'Tax', 'grand_total': 'Total', 'notes': 'Notes',
        'approved_by': 'Approved by', 'prepared_by': 'Prepared by', 'currency': 'Currency',
    }
    excluded = {'document_type','document_type_display','document_number','document_date','party_name','department','status','line_items','specific'}
    for key, label in labels.items():
        value = payload.get(key)
        if value not in (None, ''):
            lines.append(f'{label}: {value}')
    items = payload.get('line_items')
    if isinstance(items, list) and items:
        lines.extend(['', 'Items:'])
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                lines.append(f'{index}. {item}')
                continue
            description = item.get('description') or item.get('item') or item.get('name') or 'Item'
            quantity = item.get('quantity', '')
            unit = item.get('unit', '')
            price = item.get('unit_price', '')
            amount = item.get('amount', item.get('total', ''))
            lines.append(f'{index}. {description} · Qty {quantity} {unit} · Unit price {price} · Amount {amount}')
    specific = payload.get('specific')
    if isinstance(specific, dict):
        lines.extend(['', 'Document details:'])
        for key, value in specific.items():
            if value not in (None, ''):
                lines.append(f'{key.replace("_", " ").title()}: {value}')
    return '\n'.join(lines).strip()


def _create_procurement_pdf(destination, document):
    """Render a saved Procurement business document as a clean printable PDF."""
    payload = getattr(document, 'payload', None)
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            payload = {'description': payload}
    if not isinstance(payload, dict):
        payload = {}
    try:
        from xml.sax.saxutils import escape
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER, TA_RIGHT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        return _create_text_pdf(destination, getattr(document, 'document_type_display', '') or 'Procurement Document', _procurement_document_text(document))

    def text(key, fallback=''):
        value = payload.get(key, fallback)
        return str(value).strip() if value is not None else ''

    def para(value, style):
        safe = escape(str(value or '')).replace('\n', '<br/>')
        return Paragraph(safe or '—', style)

    def money(value):
        try:
            return f"{float(value):,.2f}"
        except (TypeError, ValueError):
            return str(value or '0.00')

    styles = getSampleStyleSheet()
    navy = colors.HexColor('#123b55')
    teal = colors.HexColor('#117c80')
    pale = colors.HexColor('#eef5f6')
    muted = colors.HexColor('#526575')
    organization = text('organization_name') or text('hospital_name') or 'HOSPITAL / ORGANIZATION'
    doc_type = getattr(document, 'document_type_display', None) or payload.get('document_type_display') or 'Business Document'
    doc_type = str(doc_type).strip()
    subject = text('subject') or text('contract_title') or text('document_title')
    if subject.casefold() == doc_type.casefold():
        subject = ''

    org_style = ParagraphStyle('proc-org', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=10, leading=13, textColor=teal, alignment=TA_CENTER, spaceAfter=4)
    title_style = ParagraphStyle('proc-title', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=19, leading=23, textColor=navy, alignment=TA_CENTER, spaceAfter=5)
    subject_style = ParagraphStyle('proc-subject', parent=styles['Normal'], fontName='Helvetica', fontSize=11, leading=15, textColor=muted, alignment=TA_CENTER, spaceAfter=10)
    label_style = ParagraphStyle('proc-label', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=muted)
    value_style = ParagraphStyle('proc-value', parent=styles['Normal'], fontName='Helvetica', fontSize=9, leading=12, textColor=navy)
    section_style = ParagraphStyle('proc-section', parent=styles['Heading3'], fontName='Helvetica-Bold', fontSize=10, leading=13, textColor=navy, spaceBefore=9, spaceAfter=5)
    body_style = ParagraphStyle('proc-body', parent=styles['BodyText'], fontName='Helvetica', fontSize=9, leading=14, textColor=navy, spaceAfter=4)
    right_style = ParagraphStyle('proc-right', parent=value_style, alignment=TA_RIGHT)
    width = 174 * mm
    story = [para(organization.upper(), org_style), para(doc_type.upper(), title_style)]
    if subject:
        story.append(para(subject, subject_style))
    else:
        story.append(Spacer(1, 4 * mm))

    reference = getattr(document, 'document_number', None) or payload.get('document_number') or payload.get('reference') or '—'
    document_date = getattr(document, 'document_date', None) or payload.get('document_date') or '—'
    party = getattr(document, 'party_name', None) or payload.get('party_name') or payload.get('party') or '—'
    department = getattr(document, 'department', None) or payload.get('department') or '—'
    status = getattr(document, 'status', None) or payload.get('status') or 'Draft'
    meta_rows = [
        [para('DOCUMENT NUMBER', label_style), para('DATE', label_style), para('STATUS', label_style)],
        [para(reference, value_style), para(document_date, value_style), para(status, value_style)],
        [para('PARTY / SUPPLIER', label_style), para('DEPARTMENT', label_style), para('CURRENCY', label_style)],
        [para(party, value_style), para(department, value_style), para(text('currency', 'UGX') or 'UGX', value_style)],
    ]
    metadata = Table(meta_rows, colWidths=[width / 3] * 3, repeatRows=0, hAlign='LEFT')
    metadata.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), pale), ('BOX', (0, 0), (-1, -1), .6, colors.HexColor('#cbd8dc')),
        ('INNERGRID', (0, 0), (-1, -1), .35, colors.HexColor('#d7e1e4')), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.extend([metadata, Spacer(1, 6 * mm)])

    description = text('description')
    if description:
        story.extend([para('PURPOSE / DESCRIPTION', section_style), para(description, body_style)])

    items = payload.get('line_items')
    if isinstance(items, list) and items:
        story.append(para('ITEMS / SERVICES', section_style))
        has_prices = any(item.get('unit_price') not in (None, '') or item.get('amount') not in (None, '') for item in items if isinstance(item, dict))
        headers = ['Description', 'Specification / Code', 'Qty', 'Unit']
        widths = [75 * mm, 55 * mm, 20 * mm, 24 * mm]
        if has_prices:
            headers += ['Unit Price', 'Amount']
            widths = [50 * mm, 42 * mm, 14 * mm, 16 * mm, 26 * mm, 26 * mm]
        table_data = [[para(label, label_style) for label in headers]]
        for item in items:
            if not isinstance(item, dict):
                item = {'description': item}
            row = [para(item.get('description') or item.get('item') or item.get('name') or '—', value_style),
                   para(item.get('specification') or item.get('code') or '—', value_style),
                   para(item.get('quantity', ''), value_style), para(item.get('unit', ''), value_style)]
            if has_prices:
                qty = item.get('quantity') or 0
                price = item.get('unit_price') or 0
                try:
                    amount = item.get('amount') if item.get('amount') not in (None, '') else float(qty) * float(price)
                except (TypeError, ValueError):
                    amount = item.get('amount') or ''
                row.extend([para(money(price), right_style), para(money(amount), right_style)])
            table_data.append(row)
        item_table = Table(table_data, colWidths=widths, repeatRows=1, hAlign='LEFT')
        item_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), pale), ('TEXTCOLOR', (0, 0), (-1, 0), navy),
            ('LINEBELOW', (0, 0), (-1, 0), .8, teal), ('LINEBELOW', (0, 1), (-1, -1), .3, colors.HexColor('#d7e1e4')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.extend([item_table, Spacer(1, 4 * mm)])

    specific = payload.get('specific') if isinstance(payload.get('specific'), dict) else {}
    special = []
    labels = {'valid_until':'Valid until', 'quote_reference':'Quotation reference', 'payment_terms':'Payment terms', 'delivery_date':'Required delivery date', 'delivery_location':'Delivery location', 'cost_centre':'Cost centre', 'budget_code':'Budget code', 'effective_date':'Effective date', 'expiry_date':'Expiry date', 'governing_terms':'Governing terms', 'purchase_order_number':'Purchase order number', 'received_date':'Received date', 'inspection_result':'Inspection result', 'transaction_reference':'Transaction reference', 'tax_number':'Tax / TIN number', 'supplier_contact':'Supplier contact', 'requesting_department':'Requesting department', 'requisition_number':'Requisition number'}
    excluded = {'organization_name','hospital_name','organization_address','organization_phone','organization_email','organization_tax_number','document_type','document_type_display','document_number','document_date','party_name','party','department','status','currency','subject','contract_title','document_title','description','line_items','subtotal','tax','grand_total','reference','specific','prepared_by','approved_by','notes','terms','party_contact','party_address'}
    for key, value in payload.items():
        if key in excluded or value in (None, '') or isinstance(value, (dict, list)):
            continue
        label = labels.get(key, key.replace('_', ' ').title())
        special.append((label, str(value)))
    for key, value in specific.items():
        if value not in (None, ''):
            special.append((labels.get(key, key.replace('_', ' ').title()), str(value)))
    if special:
        story.append(para('DOCUMENT DETAILS', section_style))
        detail_cells = [[para(label, label_style), para(value, value_style)] for label, value in special]
        detail_table = Table(detail_cells, colWidths=[48 * mm, width - 48 * mm], hAlign='LEFT')
        detail_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -1), .25, colors.HexColor('#d7e1e4')),
            ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(detail_table)

    totals = []
    total_values = [payload.get(key) for key in ('subtotal', 'tax', 'grand_total')]
    has_nonzero_total = any(str(value or '').strip() not in ('', '0', '0.0', '0.00') for value in total_values)
    for key, label in (('subtotal', 'Subtotal'), ('tax', 'Tax / charges'), ('grand_total', 'Grand total')) if has_nonzero_total else ():
        value = payload.get(key)
        if value not in (None, ''):
            totals.append([para(label, label_style), para(f"{text('currency', 'UGX') or 'UGX'} {money(value)}", right_style)])
    if totals:
        total_table = Table(totals, colWidths=[42 * mm, 48 * mm], hAlign='RIGHT')
        total_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'RIGHT'), ('LINEABOVE', (0, 0), (-1, 0), .6, colors.HexColor('#cbd8dc')),
            ('BACKGROUND', (0, -1), (-1, -1), pale), ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.extend([Spacer(1, 3 * mm), total_table])

    terms = text('terms')
    notes = text('notes')
    if terms:
        story.extend([para('TERMS / CONDITIONS', section_style), para(terms, body_style)])
    if notes:
        story.extend([para('NOTES / SPECIAL CONDITIONS', section_style), para(notes, body_style)])
    prepared = text('prepared_by')
    approved = text('approved_by')
    if prepared or approved:
        signatures = Table([[
            Paragraph('<b>Prepared by</b><br/>' + escape(prepared or '') + '<br/><br/>Signature: ____________________', body_style),
            Paragraph('<b>Approved / Authorized by</b><br/>' + escape(approved or '') + '<br/><br/>Signature: ____________________', body_style),
        ]], colWidths=[width / 2, width / 2])
        signatures.setStyle(TableStyle([
            ('LINEABOVE', (0, 0), (-1, 0), .6, colors.HexColor('#94a3b8')), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
        ]))
        story.extend([Spacer(1, 8 * mm), signatures])

    SimpleDocTemplate(destination, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=17 * mm, bottomMargin=17 * mm, title=str(doc_type)).build(story)


def _procurement_document_source(document):
    """Materialize a Procurement file or generated document for PDF conversion."""
    original = secure_filename(getattr(document, 'scan_file_name', None) or '')
    scan_data = getattr(document, 'scan_data', None)
    if scan_data:
        original = original or 'procurement-document.bin'
        extension = os.path.splitext(original)[1].lower()
        path = os.path.join(upload_folder(), uuid.uuid4().hex + extension)
        with open(path, 'wb') as target:
            target.write(scan_data)
        return path, original
    original = (secure_filename(getattr(document, 'title', None) or 'procurement-document') or 'procurement-document') + '.txt'
    path = os.path.join(upload_folder(), uuid.uuid4().hex + '.txt')
    with open(path, 'w', encoding='utf-8') as target:
        target.write(_procurement_document_text(document))
    return path, original


def _create_secretariate_pdf(destination, document):
    """Create the same formal paper hierarchy used by the Document Store."""
    content = getattr(document, 'content', None) or {}
    if isinstance(content, str):
        try:
            import json
            content = json.loads(content)
        except (TypeError, ValueError):
            content = {'body': content}
    if not isinstance(content, dict):
        return _create_text_pdf(destination, getattr(document, 'title', ''), content)
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    except ImportError:
        return _create_text_pdf(destination, getattr(document, 'title', ''), _secretariate_document_text(document))

    def value(key):
        return str(content.get(key, '') or '').strip()
    def markup(value):
        return str(value or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br/>')

    styles = getSampleStyleSheet()
    organization = value('organization') or 'HOSPITALSAVVY'
    type_name = value('type_title') or getattr(document, 'document_type', '') or 'Secretariate Document'
    subject = value('subject') or getattr(document, 'title', '') or type_name
    heading = ParagraphStyle('office-heading', parent=styles['Heading1'], alignment=TA_CENTER, fontName='Helvetica-Bold', fontSize=17, leading=21, spaceAfter=10)
    label = ParagraphStyle('office-label', parent=styles['BodyText'], fontName='Helvetica-Bold', fontSize=9, leading=13)
    body = ParagraphStyle('office-body', parent=styles['BodyText'], fontName='Times-Roman', fontSize=11, leading=18, spaceAfter=10)
    section = ParagraphStyle('office-section', parent=styles['Heading3'], fontName='Helvetica-Bold', fontSize=10, leading=14, spaceBefore=10, spaceAfter=5)
    story = [
        Paragraph(markup(organization.upper()), ParagraphStyle('office-org', parent=label, alignment=TA_CENTER, fontSize=11, leading=15, spaceAfter=5)),
        Paragraph(markup(type_name.upper()), ParagraphStyle('office-type', parent=label, alignment=TA_CENTER, fontSize=9, leading=13, spaceAfter=4)),
        Paragraph(markup(subject), heading),
    ]
    metadata = []
    for key, text in (('number', 'Reference'), ('date', 'Date'), ('recipient', 'To / Audience'), ('author', 'Prepared by')):
        item = value(key)
        if item:
            metadata.append(Paragraph(f'<b>{text}:</b> {markup(item)}', label))
    if metadata:
        if len(metadata) % 2:
            metadata.append('')
        table = Table([metadata[index:index + 2] for index in range(0, len(metadata), 2)], colWidths=[87 * mm, 87 * mm])
        table.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), .5, colors.HexColor('#94a3b8')), ('INNERGRID', (0, 0), (-1, -1), .25, colors.HexColor('#cbd5e1')), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
        story.extend([table, Spacer(1, 6 * mm)])
    specific = content.get('specific') if isinstance(content.get('specific'), dict) else {}
    if value('type') == 'letter' and value('recipient'):
        story.extend([Paragraph(markup(value('recipient')), body), Spacer(1, 2 * mm)])
    if specific.get('salutation'):
        story.extend([Paragraph(markup(specific['salutation']), body), Spacer(1, 1 * mm)])
    if value('body'):
        story.append(Paragraph(markup(value('body')), body))
    if specific.get('closing'):
        story.append(Paragraph(markup(specific['closing']), body))
    for title, item in (('Recommendations / Conclusion', value('actions')), ('Distribution / Attachments', value('attachments'))):
        if item:
            story.extend([Paragraph(title, section), Paragraph(markup(item), body)])
    if value('author') or value('approver'):
        signatures = Table([[Paragraph('<b>Prepared by</b><br/>' + markup(value('author')) + '<br/><br/>Signature: ____________________', body), Paragraph('<b>Approved / Signed by</b><br/>' + markup(value('approver')) + '<br/><br/>Date: ____________________', body)]], colWidths=[87 * mm, 87 * mm])
        signatures.setStyle(TableStyle([('LINEABOVE', (0, 0), (-1, 0), .5, colors.HexColor('#94a3b8')), ('TOPPADDING', (0, 0), (-1, -1), 12), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
        story.extend([Spacer(1, 8 * mm), signatures])
    SimpleDocTemplate(destination, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm).build(story)


def _create_basic_pdf(destination, title, content):
    """Create a styled, multi-page PDF without relying on optional packages."""
    import textwrap

    def pdf_text(value):
        value = str(value or '').encode('latin-1', 'replace').decode('latin-1')
        return value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    def wrap(value, size=10, width=470):
        columns = max(24, int(width / (size * .52)))
        return textwrap.wrap(str(value or ''), width=columns, replace_whitespace=False,
                             break_long_words=True, break_on_hyphens=False) or ['']

    pages = [[]]
    y = 738

    def command(text, x, baseline, size=10, bold=False, color=(.09, .23, .32)):
        font = '/F2' if bold else '/F1'
        pages[-1].append(f"BT {color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg {font} {size} Tf 1 0 0 1 {x:.1f} {baseline:.1f} Tm ({pdf_text(text)}) Tj ET")

    def new_page():
        nonlocal y
        pages.append([])
        y = 770

    safe_title = str(title or 'Forwarded document').strip()
    title_lines = wrap(safe_title, 17, 480)
    for title_line in title_lines:
        estimated_width = len(title_line) * 8.5
        command(title_line, max(58, (595 - estimated_width) / 2), y + 37, 17, True, (.07, .23, .32))
        y -= 21
    rule_y = 750 - (len(title_lines) - 1) * 21
    pages[-1].append(f'q 0.067 0.486 0.502 RG 1.4 w 58 {rule_y:.1f} m 537 {rule_y:.1f} l S Q')
    y = rule_y - 23

    source_lines = str(content or 'No document content was recorded.').splitlines()
    blocks = []
    for line in source_lines:
        if not line.strip():
            blocks.append(None)
        else:
            blocks.append(line.strip())

    # Documents produced by the text-only fallback often start with an
    # organization/document line, then compact reference/date metadata.
    if blocks and blocks[0] and (blocks[0].isupper() or '—' in blocks[0]):
        for line in wrap(blocks.pop(0), 9, 478):
            command(line, 58, y, 9, True, (.07, .49, .50)); y -= 14
        y -= 8

    alternate = False
    for line in blocks:
        if line is None:
            y -= 10
            continue
        if y < 75:
            new_page()
        if line.endswith(':') and len(line) < 90:
            y -= 5
            command(line[:-1], 58, y, 9, True, (.34, .42, .49))
            y -= 17
            continue
        if ':' in line:
            label, value = line.split(':', 1)
            label = label.strip()
            value = value.strip()
            wrapped_value = wrap(value or '—', 10, 340)
            row_height = max(25, 11 + len(wrapped_value) * 13)
            if y - row_height < 65:
                new_page()
            fill = '.945 .965 .969' if alternate else '.975 .982 .984'
            pages[-1].append(f'q {fill} rg 58 {y-row_height+4:.1f} 479 {row_height:.1f} re f Q')
            command(label, 68, y - 8, 8, True, (.34, .42, .49))
            for index, value_line in enumerate(wrapped_value):
                command(value_line, 205, y - 8 - index * 13, 10, False, (.09, .23, .32))
            y -= row_height
            alternate = not alternate
            continue
        wrapped = wrap(line, 10, 470)
        for wrapped_line in wrapped:
            if y < 65:
                new_page()
            command(wrapped_line, 58, y, 10, False, (.09, .23, .32))
            y -= 14

    # A restrained footer keeps multi-page documents clear when printed.
    for index, page_commands in enumerate(pages, start=1):
        page_commands.extend([
            'q 0.82 0.87 0.89 RG .5 w 58 43 m 537 43 l S Q',
            f'BT 0.36 0.43 0.49 rg /F1 8 Tf 1 0 0 1 58 29 Tm ({pdf_text("HospitalSavvy · " + str(index) + " / " + str(len(pages)))}) Tj ET',
        ])

    objects = ['<< /Type /Catalog /Pages 2 0 R >>', '']
    page_ids = []
    for page_commands in pages:
        page_id = len(objects) + 1; content_id = page_id + 1; page_ids.append(page_id)
        stream = '\n'.join(page_commands).encode('latin-1')
        objects.extend([
            f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents {content_id} 0 R >>',
            f'<< /Length {len(stream)} >>\nstream\n' + stream.decode('latin-1') + '\nendstream',
        ])
    objects[1] = '<< /Type /Pages /Kids [' + ' '.join(f'{page_id} 0 R' for page_id in page_ids) + f'] /Count {len(page_ids)} >>'
    encoded = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(encoded))
        encoded.extend(f'{index} 0 obj\n{obj}\nendobj\n'.encode('latin-1'))
    xref = len(encoded)
    encoded.extend(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode('ascii'))
    for offset in offsets[1:]: encoded.extend(f'{offset:010d} 00000 n \n'.encode('ascii'))
    encoded.extend(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode('ascii'))
    with open(destination, 'wb') as output: output.write(encoded)


def convert_to_pdf(source_path, original_filename, title='', document_content=''):
    """Return a new PDF path and public filename for a forwarded attachment."""
    original_filename = secure_filename(original_filename or 'document') or 'document'
    stem, extension = os.path.splitext(original_filename)
    extension = extension.lower()
    pdf_filename = f"{stem or 'document'}.pdf"
    destination = os.path.join(upload_folder(), f"{uuid.uuid4().hex}.pdf")
    if extension == '.pdf':
        shutil.copyfile(source_path, destination)
    elif extension in {'.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'}:
        try:
            from PIL import Image
            with Image.open(source_path) as image:
                frames = []
                try:
                    while True:
                        frames.append(image.convert('RGB').copy())
                        image.seek(image.tell() + 1)
                except EOFError:
                    pass
                frames[0].save(destination, 'PDF', save_all=True, append_images=frames[1:])
        except ImportError as exc:
            raise ValueError('Image-to-PDF conversion requires Pillow to be installed.') from exc
    else:
        content = document_content or _document_text(source_path, extension)
        _create_text_pdf(destination, title or stem, content)
    return destination, pdf_filename


def _voucher_pdf_content(reference, recipient, amount, purpose, payment_method, approved_by, notes, created_by):
    """Use a fixed template so Finance vouchers are clear and consistently printable."""
    created = datetime.now().strftime('%Y-%m-%d %H:%M')
    return '\n'.join([
        'HOSPITALSAVVY — ACCOUNTS DISPENSING VOUCHER',
        f'Reference: {reference}',
        f'Created: {created}',
        '',
        f'Payee / recipient: {recipient}',
        f'Amount: {amount:,.2f}',
        f'Payment method: {payment_method or "Not specified"}',
        f'Approved by: {approved_by or "Pending approval"}',
        '',
        'Purpose / justification:', purpose,
        '',
        f'Notes: {notes or "None"}',
        '',
        f'Prepared by Finance: {created_by}',
        'System record — attach this PDF when forwarding to Hospital Administration or Procurement.',
    ])


def _create_accounts_dispensing_pdf(destination, reference, recipient, amount, purpose, payment_method, approved_by, notes, created_by, created_at=None):
    """Render a saved Finance voucher as a structured, print-ready document."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT, TA_RIGHT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        return _create_text_pdf(destination, 'Finance Dispensing Voucher', _voucher_pdf_content(
            reference, recipient, amount, purpose, payment_method, approved_by, notes, created_by,
        ))

    def safe(value):
        text = str(value if value is not None else '').strip()
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br/>') or '—'

    created_value = created_at or datetime.now()
    created = created_value.strftime('%d %B %Y, %H:%M') if hasattr(created_value, 'strftime') else str(created_value)
    navy = colors.HexColor('#123b52')
    teal = colors.HexColor('#117c80')
    muted = colors.HexColor('#5c6f7d')
    pale = colors.HexColor('#f1f7f8')
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('VoucherTitle', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=20, leading=25, textColor=navy, alignment=TA_LEFT, spaceAfter=2)
    body_style = ParagraphStyle('VoucherBody', parent=styles['BodyText'], fontName='Helvetica', fontSize=10, leading=15, textColor=navy)
    label_style = ParagraphStyle('VoucherLabel', parent=body_style, fontName='Helvetica-Bold', fontSize=8, leading=11, textColor=muted, spaceAfter=3)
    value_style = ParagraphStyle('VoucherValue', parent=body_style, fontSize=11, leading=15)
    amount_style = ParagraphStyle('VoucherAmount', parent=body_style, fontName='Helvetica-Bold', fontSize=17, leading=21, textColor=teal, alignment=TA_RIGHT)
    right_style = ParagraphStyle('VoucherRight', parent=body_style, alignment=TA_RIGHT, textColor=muted)
    width = A4[0] - 36 * mm
    story = [
        Paragraph('HOSPITALSAVVY', ParagraphStyle('Brand', parent=body_style, fontName='Helvetica-Bold', fontSize=9, leading=12, textColor=teal, spaceAfter=8)),
        Paragraph('Funds Dispensing Voucher', title_style),
        Paragraph('FINANCE DOCUMENT', ParagraphStyle('Eyebrow', parent=label_style, textColor=teal, spaceAfter=13)),
    ]
    meta = Table([[Paragraph('<b>REFERENCE</b><br/>' + safe(reference), body_style), Paragraph('<b>CREATED</b><br/>' + safe(created), right_style)]], colWidths=[width * .58, width * .42])
    meta.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), pale), ('BOX', (0, 0), (-1, -1), .6, colors.HexColor('#d5e3e6')),
        ('LEFTPADDING', (0, 0), (-1, -1), 11), ('RIGHTPADDING', (0, 0), (-1, -1), 11),
        ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.extend([meta, Spacer(1, 8 * mm)])

    def field(label, value, style=value_style, cell_width=None):
        cell = Table([[Paragraph(label.upper(), label_style)], [Paragraph(safe(value), style)]], colWidths=[cell_width or width / 2])
        cell.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
        return cell

    recipient_cell = field('Payee / recipient', recipient, cell_width=width * .58)
    amount_cell = field('Amount', f'{amount:,.2f}', amount_style, cell_width=width * .42)
    parties = Table([[recipient_cell, amount_cell]], colWidths=[width * .58, width * .42])
    parties.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.white), ('BOX', (0, 0), (-1, -1), .6, colors.HexColor('#d5e3e6')),
        ('LINEBEFORE', (1, 0), (1, 0), .6, colors.HexColor('#d5e3e6')),
        ('LEFTPADDING', (0, 0), (-1, -1), 11), ('RIGHTPADDING', (0, 0), (-1, -1), 11),
        ('TOPPADDING', (0, 0), (-1, -1), 11), ('BOTTOMPADDING', (0, 0), (-1, -1), 11), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.extend([parties, Spacer(1, 6 * mm)])

    details = Table([[field('Payment method', payment_method or 'Not specified'), field('Approved by', approved_by or 'Pending approval')]], colWidths=[width / 2, width / 2])
    details.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), pale), ('BOX', (0, 0), (-1, -1), .6, colors.HexColor('#d5e3e6')),
        ('LINEBEFORE', (1, 0), (1, 0), .6, colors.HexColor('#d5e3e6')),
        ('LEFTPADDING', (0, 0), (-1, -1), 11), ('RIGHTPADDING', (0, 0), (-1, -1), 11),
        ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.extend([details, Spacer(1, 7 * mm)])
    story.extend([Paragraph('PURPOSE / JUSTIFICATION', label_style), Paragraph(safe(purpose), body_style), Spacer(1, 6 * mm)])
    story.extend([Paragraph('NOTES', label_style), Paragraph(safe(notes or 'None'), body_style), Spacer(1, 13 * mm)])

    prepared = Table([[Paragraph('<b>Prepared by</b><br/>' + safe(created_by), body_style), Paragraph('<b>Finance record</b><br/>Created ' + safe(created), right_style)]], colWidths=[width / 2, width / 2])
    prepared.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (-1, 0), .8, teal), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 9), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(prepared)
    SimpleDocTemplate(destination, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm, title=f'Funds Dispensing Voucher {reference}', author='HospitalSavvy Finance').build(story)


@communication_bp.get('/accounts-dispensing')
@require_roles({'accountant', 'accounts', 'accounts_officer', 'finance', 'finance_officer', 'hospital_manager', 'system_admin'})
def accounts_dispensing_documents():
    rows = AccountsDispensingDocument.query.order_by(AccountsDispensingDocument.created_at.desc()).limit(250).all()
    return jsonify(success=True, documents=[row.to_dict() for row in rows])


@communication_bp.post('/accounts-dispensing')
@require_roles({'accountant', 'accounts', 'accounts_officer', 'finance_officer'})
def create_accounts_dispensing_document():
    data = request.get_json(silent=True) or {}
    recipient = str(data.get('recipient') or '').strip()
    purpose = str(data.get('purpose') or '').strip()
    try:
        amount = float(data.get('amount'))
    except (TypeError, ValueError):
        return json_error('Enter a valid dispensing amount.')
    if not recipient or not purpose or amount <= 0:
        return json_error('Recipient, a positive amount, and purpose are required.')
    user = session_user(); created_by = str(user.get('username') or 'Finance')
    reference = 'ADV-' + datetime.now().strftime('%Y%m%d%H%M%S') + '-' + uuid.uuid4().hex[:4].upper()
    filename = f'{reference}.pdf'; stored_filename = f'{uuid.uuid4().hex}.pdf'
    path = os.path.join(upload_folder(), stored_filename)
    try:
        _create_accounts_dispensing_pdf(
            path, reference, recipient, amount, purpose,
            str(data.get('payment_method') or '').strip(), str(data.get('approved_by') or '').strip(),
            str(data.get('notes') or '').strip(), created_by,
        )
        row = AccountsDispensingDocument(
            reference=reference, recipient=recipient[:200], amount=amount, purpose=purpose,
            payment_method=str(data.get('payment_method') or '').strip()[:100] or None,
            approved_by=str(data.get('approved_by') or '').strip()[:200] or None,
            notes=str(data.get('notes') or '').strip() or None, created_by=created_by,
            stored_filename=stored_filename,
        )
        db.session.add(row); db.session.commit()
        return jsonify(success=True, document=row.to_dict()), 201
    except Exception:
        db.session.rollback()
        try: os.remove(path)
        except OSError: pass
        current_app.logger.exception('Could not create Finance dispensing voucher')
        return json_error('Could not create the dispensing document.', 500)


@communication_bp.get('/accounts-dispensing/<int:document_id>/download')
@require_roles(ROLES)
def download_accounts_dispensing_document(document_id):
    row = db.session.get(AccountsDispensingDocument, document_id)
    if not row: abort(404)
    path = os.path.join(upload_folder(), uuid.uuid4().hex + '.pdf')
    try:
        _create_accounts_dispensing_pdf(path, row.reference, row.recipient, row.amount, row.purpose,
                                        row.payment_method, row.approved_by, row.notes, row.created_by,
                                        getattr(row, 'created_at', None))
        response = send_file(path, mimetype='application/pdf', as_attachment=True, download_name=f'{row.reference}.pdf')
        response.call_on_close(lambda: os.path.exists(path) and os.remove(path))
        return response
    except Exception:
        try: os.remove(path)
        except OSError: pass
        current_app.logger.exception('Could not render Finance dispensing document for download')
        return json_error('Could not prepare the dispensing document for download.', 500)

@communication_bp.get('/messages')
@require_roles(ROLES)
def messages():
    dept=active_department()
    rows=DepartmentMessage.query.filter((DepartmentMessage.sender_department==dept)|(DepartmentMessage.recipient_department==dept)).order_by(DepartmentMessage.created_at.desc()).limit(250).all()
    return jsonify(success=True,department=dept,messages=[r.to_dict() for r in rows])

@communication_bp.get('/forwards')
@require_roles(ROLES)
def forwards():
    dept=active_department()
    rows=DepartmentMessage.query.filter(DepartmentMessage.forward_id.isnot(None),((DepartmentMessage.sender_department==dept)|(DepartmentMessage.recipient_department==dept))).order_by(DepartmentMessage.created_at.desc()).limit(250).all()
    ids=[row.forward_id for row in rows]
    docs=DepartmentSharedDocument.query.filter(DepartmentSharedDocument.forward_id.in_(ids)).order_by(DepartmentSharedDocument.created_at.asc()).all() if ids else []
    grouped={row.forward_id: {'id':row.forward_id,'sender_department':row.sender_department,'recipient_department':row.recipient_department,'sender_name':row.sender_name,'title':row.subject,'message':row.message or row.body,'created_at':row.created_at.isoformat()+'Z','view_url':f'/api/department-communication/forwards/{row.forward_id}/view','download_url':f'/api/department-communication/forwards/{row.forward_id}/download','attachments':[]} for row in rows}
    for doc in docs:
        if doc.forward_id in grouped: grouped[doc.forward_id]['attachments'].append(doc.to_dict())
    return jsonify(success=True,department=dept,forwards=list(grouped.values()))


def _forward_bundle(forward_id, dept, download):
    row=DepartmentMessage.query.filter_by(forward_id=forward_id).first()
    if not row or dept not in (row.sender_department,row.recipient_department): return redirect(url_for('hms'))
    docs=DepartmentSharedDocument.query.filter_by(forward_id=forward_id).order_by(DepartmentSharedDocument.created_at.asc()).all()
    paths=[os.path.join(upload_folder(),doc.stored_filename) for doc in docs]
    if not paths or not all(os.path.isfile(path) for path in paths): return redirect(url_for('hms'))
    try:
        from pypdf import PdfReader, PdfWriter
        writer=PdfWriter(); reader_refs=[]
        for doc, path in zip(docs, paths):
            # Finance vouchers created before the structured PDF layout was
            # introduced are rebuilt from their saved fields when viewed.
            # Existing inline signatures are carried onto the refreshed page.
            reference = os.path.splitext(os.path.basename(doc.original_filename or ''))[0]
            finance_voucher = AccountsDispensingDocument.query.filter_by(reference=reference).first() if reference.startswith('ADV-') else None
            generated = None
            source_path = path
            if finance_voucher:
                original_text = '\n'.join(page.extract_text() or '' for page in PdfReader(path).pages)
                signature_pattern = re.compile(r'Signed by:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})')
                signatures = signature_pattern.findall(original_text)
                if signatures:
                    generated = os.path.join(upload_folder(), uuid.uuid4().hex + '.pdf')
                    try:
                        _create_accounts_dispensing_pdf(
                            generated, finance_voucher.reference, finance_voucher.recipient,
                            finance_voucher.amount, finance_voucher.purpose, finance_voucher.payment_method,
                            finance_voucher.approved_by, finance_voucher.notes, finance_voucher.created_by,
                            getattr(finance_voucher, 'created_at', None),
                        )
                        signatures_ok = True
                        for signed_name, signed_role, signed_time in signatures:
                            try:
                                signed_at = datetime.strptime(signed_time, '%Y-%m-%d %H:%M')
                            except ValueError:
                                signed_at = None
                            if stamp_file(generated, '.pdf', signed_name, signed_role, signed_at) is False:
                                signatures_ok = False
                                break
                        if signatures_ok:
                            source_path = generated
                        else:
                            os.remove(generated)
                            generated = None
                    except Exception:
                        try: os.remove(generated)
                        except OSError: pass
                        generated = None
                        source_path = path
            try:
                _append_forward_document(writer, source_path, row.sender_name, row.created_at, reader_refs)
            finally:
                if generated:
                    try: os.remove(generated)
                    except OSError: pass
        stream=io.BytesIO(); writer.write(stream); stream.seek(0)
    except ImportError:
        # The package remains usable on minimal installs. This fallback makes
        # one multi-page readable package, while installing pypdf preserves
        # the original attachment pages exactly.
        temporary=os.path.join(upload_folder(),uuid.uuid4().hex+'.pdf')
        try:
            _create_basic_pdf(temporary,row.subject or 'Forwarded item',('\n' * 53).join(f'Attachment {index + 1}: {doc.original_filename}' for index,doc in enumerate(docs)))
            with open(temporary,'rb') as source: stream=io.BytesIO(source.read())
            stream.seek(0)
        finally:
            try: os.remove(temporary)
            except OSError: pass
    name=(secure_filename(row.subject or 'forwarded-item') or 'forwarded-item')+'.pdf'
    response = send_file(stream,mimetype='application/pdf',as_attachment=download,download_name=name)
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response


@communication_bp.get('/forwards/<forward_id>/pdf')
@require_roles(ROLES)
def forwarded_pdf(forward_id):
    """Serve the generated attachment itself (used by the viewer page)."""
    return _forward_bundle(forward_id,active_department(),False)


@communication_bp.get('/forwards/<forward_id>/view')
@require_roles(ROLES)
def view_forward_bundle(forward_id):
    """Open a PDF viewer with explicit print and return actions."""
    dept = active_department()
    row = DepartmentMessage.query.filter_by(forward_id=forward_id).first()
    if not row or dept not in (row.sender_department, row.recipient_department):
        return redirect(url_for('hms'))
    pdf_url = url_for('department_communication.forwarded_pdf', forward_id=forward_id)
    download_url = url_for('department_communication.download_forward_bundle', forward_id=forward_id)
    return render_template_string('''<!doctype html>
      <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>{{ title }} — Forwarded document</title>
      <style>body{margin:0;background:#e2e8f0;font:15px Arial,sans-serif;color:#172033}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 18px;background:#fff;border-bottom:1px solid #cbd5e1}.bar strong{margin-right:auto}.btn{border:0;border-radius:6px;padding:9px 13px;background:#2563eb;color:#fff;font:inherit;cursor:pointer;text-decoration:none}.btn.secondary{background:#475569}iframe{border:0;width:100%;height:calc(100vh - 62px);display:block;background:#fff}@media print{.bar{display:none}iframe{height:100vh}}</style>
      </head><body><nav class="bar"><strong>{{ title }}</strong><button class="btn" type="button" onclick="printDocument()">Print</button><a class="btn secondary" href="{{ download_url }}">Download PDF</a><button class="btn secondary" type="button" onclick="returnToForwarding()">Return</button></nav>
      <iframe id="forwarded-pdf" title="Forwarded document PDF" src="{{ pdf_url }}"></iframe>
      <script>function printDocument(){const frame=document.getElementById('forwarded-pdf');try{frame.contentWindow.focus();frame.contentWindow.print()}catch(_){window.print()}}function returnToForwarding(){if(window.history.length>1){window.history.back()}else{window.close()}}</script>
      </body></html>''', title=row.subject or 'Forwarded document', pdf_url=pdf_url, download_url=download_url)


@communication_bp.get('/forwards/<forward_id>/download')
@require_roles(ROLES)
def download_forward_bundle(forward_id):
    return _forward_bundle(forward_id,active_department(),True)

@communication_bp.post('/messages')
@require_roles(ROLES)
def send_message():
    dept=active_department(); data=request.get_json(silent=True) or {}
    recipient=str(data.get('recipient_department') or '').strip().lower(); message=str(data.get('message') or '').strip()
    if not dept or recipient not in DEPARTMENTS or recipient==dept: return json_error('Choose another valid destination department.')
    if not message: return json_error('Message cannot be empty.')
    user=session_user(); sender_name=str(user.get('username') or 'Staff'); sender_user_id=user.get('id')
    if not sender_user_id: return json_error('Your session does not include a user ID. Please sign in again.', 401)
    row=DepartmentMessage(sender_user_id=int(sender_user_id),sender_department=dept,recipient_department=recipient,sender_name=sender_name,subject='Forwarding message',body=message[:10000],message=message[:10000])
    db.session.add(row); db.session.commit(); return jsonify(success=True,message=row.to_dict()),201


def forwarding_role_title():
    role = str(getattr(request, 'office_role', '') or session_user().get('role') or '').strip().lower().replace('-', '_').replace(' ', '_')
    labels = {
        'system_admin': 'System Administrator', 'admin': 'System Administrator',
        'hospital_manager': 'Hospital Manager', 'procurement_officer': 'Procurement Officer',
        'finance_officer': 'Finance Officer', 'finance': 'Finance Officer',
        'accountant': 'Finance Officer', 'accounts_officer': 'Finance Officer', 'accounts': 'Finance Officer',
    }
    return labels.get(role, role.replace('_', ' ').title() or 'Authorized Staff')


def stamp_file(path, extension, sender_name, sender_role, signed_at=None):
    """Add a non-overlapping, name-and-role signature stamp to the last PDF page."""
    if extension.lower() != '.pdf':
        raise ValueError('Forwarded files must be converted to PDF before signing.')
    try:
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import RectangleObject
        from reportlab.lib import colors
        from reportlab.pdfgen import canvas
        from reportlab.pdfbase.pdfmetrics import stringWidth
    except ImportError:
        # Do not prevent a time-sensitive hospital document from being sent.
        return False

    now = datetime.now()
    signed_at = signed_at or now
    if not isinstance(signed_at, datetime):
        signed_at = now
    role = str(sender_role or 'Authorized Staff').strip()
    name = str(sender_name or 'Staff').strip()
    stamp = f"Signed by: {name} | {role} | {signed_at.strftime('%Y-%m-%d %H:%M')}"
    stamp = stamp.encode('latin-1', 'replace').decode('latin-1')
    row_height = 14.0
    initial_footer_height = row_height * 3 + 12.0
    with open(path, 'rb') as source:
        reader = PdfReader(source)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        page = writer.pages[-1]
        existing_stamps = (page.extract_text() or '').count('Signed by:')
        # Reserve three rows on the first transfer. Each additional group gets
        # one more row and shifts the page content up, never over previous rows.
        band_height = initial_footer_height if existing_stamps == 0 else (row_height if existing_stamps >= 3 else 0.0)
        box = page.mediabox
        left, bottom = float(box.left), float(box.bottom)
        width, height = float(box.width), float(box.height)
        if band_height:
            page.add_transformation((1, 0, 0, 1, 0, band_height))
            expanded = RectangleObject((left, bottom, left + width, bottom + height + band_height))
            page.mediabox = expanded
            page.cropbox = RectangleObject(expanded)
            page.bleedbox = RectangleObject(expanded)
            page.trimbox = RectangleObject(expanded)
            page.artbox = RectangleObject(expanded)
        else:
            expanded = page.mediabox

        footer = io.BytesIO()
        footer_height = float(expanded.height)
        c = canvas.Canvas(footer, pagesize=(width, footer_height))
        c.saveState()
        c.setFillColor(colors.HexColor('#117c80'))
        c.setFont('Helvetica-Bold', 8)
        c.setStrokeColor(colors.HexColor('#cbd8dc'))
        c.setLineWidth(.5)
        c.line(left + 24, bottom + 5, left + width - 24, bottom + 5)
        font_size = 8.0
        max_text_width = max(40, width - 48)
        while stringWidth(stamp, 'Helvetica-Bold', font_size) > max_text_width and font_size > 6:
            font_size -= .25
        c.setFont('Helvetica-Bold', font_size)
        if existing_stamps >= 3:
            stamp_y = bottom + 8
        else:
            stamp_y = bottom + 8 + row_height * existing_stamps
        c.drawString(left + 24, stamp_y, stamp)
        c.restoreState()
        c.save()
        footer.seek(0)
        page.merge_page(PdfReader(footer).pages[0])

        output = io.BytesIO()
        writer.write(output)

    temporary_path = os.path.join(os.path.dirname(path), uuid.uuid4().hex + '.pdf')
    try:
        with open(temporary_path, 'wb') as destination:
            destination.write(output.getvalue())
        os.replace(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
    return True


def _append_forward_document(bundle_writer, path, sender_name, fallback_time=None, reader_refs=None):
    """Replace legacy full-page transfer records with inline name/role stamps."""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(path)
    retained = []
    legacy_records = []
    for page in reader.pages:
        page_text = page.extract_text() or ''
        if 'TRANSFER SIGNATURE RECORD' in page_text.upper():
            legacy_records.append(page_text)
        else:
            retained.append(page)

    if not legacy_records or not retained:
        if reader_refs is not None:
            reader_refs.append(reader)
        for page in retained:
            bundle_writer.add_page(page)
        return

    roles = ('System Administrator', 'Hospital Manager', 'Procurement Officer', 'Finance Officer')
    writer = PdfWriter()
    for page in retained:
        writer.add_page(page)
    temporary = os.path.join(os.path.dirname(path), uuid.uuid4().hex + '.pdf')
    try:
        with open(temporary, 'wb') as destination:
            writer.write(destination)
        for record in legacy_records:
            text_lower = record.lower()
            role = next((candidate for candidate in roles if candidate.lower() in text_lower), 'Authorized Staff')
            match = re.search(r'\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\b', record)
            signed_at = fallback_time
            if match:
                for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M'):
                    try:
                        signed_at = datetime.strptime(match.group(0), fmt)
                        break
                    except ValueError:
                        continue
            if stamp_file(temporary, '.pdf', sender_name, role, signed_at) is False:
                break
        with open(temporary, 'rb') as signed:
            signed_buffer = io.BytesIO(signed.read())
        signed_reader = PdfReader(signed_buffer)
        if reader_refs is not None:
            reader_refs.append((signed_reader, signed_buffer))
        for page in signed_reader.pages:
            bundle_writer.add_page(page)
    finally:
        try: os.remove(temporary)
        except OSError: pass


@communication_bp.post('/send')
@require_roles(ROLES)
def send_item():
    """Send a message with a local upload or a file selected from the Secretariat store."""
    dept=active_department(); recipient=str(request.form.get('recipient_department') or '').strip().lower(); message=str(request.form.get('message') or '').strip(); title=str(request.form.get('title') or '').strip()
    file=request.files.get('file'); selected_id=str(request.form.get('secretariate_document_id') or '').strip(); procurement_id=str(request.form.get('procurement_document_id') or '').strip(); accounts_id=str(request.form.get('accounts_dispensing_document_id') or '').strip(); stamp=True; conversion_requested=request.form.get('convert_to_pdf') == 'yes'
    if not dept or recipient not in DEPARTMENTS or recipient==dept: return json_error('Choose another valid destination department.')
    if not message and not ((file and file.filename) or selected_id or procurement_id or accounts_id): return json_error('Write a message or attach a file.')
    user=session_user(); sender_name=str(user.get('username') or 'Staff'); sender_user_id=user.get('id'); doc=None; path=None; temporary_source=None; stamp_unavailable=False
    if not sender_user_id: return json_error('Your session does not include a user ID. Please sign in again.', 401)
    try:
        original=''; mime='application/octet-stream'; ext=''
        if accounts_id:
            if dept != 'accounts': return json_error('Only Finance can attach a Finance dispensing document.')
            try: store_doc = db.session.get(AccountsDispensingDocument, int(accounts_id))
            except (TypeError, ValueError): store_doc = None
            if not store_doc: return json_error('The selected Finance dispensing document was not found.')
            original = f'{store_doc.reference}.pdf'; mime = 'application/pdf'; ext = '.pdf'; title = title or f'Dispensing voucher {store_doc.reference}'
            source = os.path.join(upload_folder(), store_doc.stored_filename)
            if not os.path.isfile(source): return json_error('The selected Finance document file could not be found.')
            path = os.path.join(upload_folder(), f'{uuid.uuid4().hex}.pdf'); shutil.copyfile(source, path)
        elif selected_id or procurement_id:
            procurement_selected=bool(procurement_id)
            try: store_doc=db.session.get(ProcurementDocument if procurement_selected else SecretariateDocument, int(procurement_id if procurement_selected else selected_id))
            except (TypeError, ValueError): store_doc=None
            if not store_doc: return json_error('The selected document store item was not found.')
            title=title or store_doc.title
            if procurement_selected:
                if store_doc.is_scanned_document and store_doc.scan_data:
                    source, original = _procurement_document_source(store_doc)
                    try:
                        if conversion_requested:
                            path, original = convert_to_pdf(source, original, title, _procurement_document_text(store_doc))
                            mime='application/pdf'; ext='.pdf'
                        else:
                            ext=os.path.splitext(original)[1].lower()
                            path=os.path.join(upload_folder(),uuid.uuid4().hex+ext)
                            shutil.copyfile(source,path)
                            mime=store_doc.scan_mime_type or 'application/octet-stream'
                    finally:
                        try: os.remove(source)
                        except OSError: pass
                else:
                    ext='.pdf'; mime='application/pdf'
                    original=(secure_filename(store_doc.document_type_display or store_doc.title or 'Procurement Document') or 'Procurement-Document')+'.pdf'
                    path=os.path.join(upload_folder(),uuid.uuid4().hex+ext)
                    _create_procurement_pdf(path,store_doc)
            else:
                original=secure_filename(store_doc.original_filename or (store_doc.title + '.txt')) or 'document.txt'
                mime=store_doc.mime_type or 'application/octet-stream'; ext=os.path.splitext(original)[1].lower()
                source=os.path.join(upload_folder(),store_doc.stored_filename) if store_doc.stored_filename else None
                if source and not os.path.isfile(source): return json_error('The selected document file could not be found in its Document Store.')
                if conversion_requested:
                    if source:
                        path, original=convert_to_pdf(source, original, title, getattr(store_doc, 'content', '') or '')
                    else:
                        path=os.path.join(upload_folder(), f"{uuid.uuid4().hex}.pdf")
                        _create_text_pdf(path, title, getattr(store_doc, 'content', '') or '')
                        original=(os.path.splitext(original)[0] or 'document') + '.pdf'
                    mime='application/pdf'; ext='.pdf'
                elif source:
                    stored=uuid.uuid4().hex+ext; path=os.path.join(upload_folder(),stored); shutil.copyfile(source,path)
                else:
                    return json_error('This document has no uploaded file. Enable PDF conversion to forward its stored content.')
        elif file and file.filename:
            original=secure_filename(file.filename) or 'attachment.bin'; ext=os.path.splitext(original)[1].lower(); mime=file.mimetype or 'application/octet-stream'
            file.stream.seek(0,os.SEEK_END); size=file.stream.tell(); file.stream.seek(0)
            if size>100*1024*1024: return json_error('Maximum file size is 100 MB.')
            temporary_source=os.path.join(upload_folder(),uuid.uuid4().hex+ext); file.save(temporary_source)
            if conversion_requested:
                path, original=convert_to_pdf(temporary_source, original, title)
                mime='application/pdf'; ext='.pdf'
                os.remove(temporary_source); temporary_source=None
            else:
                path=temporary_source; temporary_source=None
        if path:
            if stamp:
                try:
                    if ext.lower() != '.pdf':
                        signed_pdf, original = convert_to_pdf(path, original, title)
                        try: os.remove(path)
                        except OSError: pass
                        path=signed_pdf; ext='.pdf'; mime='application/pdf'
                    if stamp_file(path, ext, sender_name, forwarding_role_title()) is False:
                        stamp_unavailable=True
                except ValueError as exc:
                    try: os.remove(path)
                    except OSError: pass
                    return json_error(str(exc))
            doc=DepartmentSharedDocument(sender_department=dept,recipient_department=recipient,title=(title or original)[:240],original_filename=original[:255],stored_filename=os.path.basename(path),mime_type=mime,uploaded_by=sender_name)
            db.session.add(doc)
        msg=None
        if message:
            msg=DepartmentMessage(sender_user_id=int(sender_user_id),sender_department=dept,recipient_department=recipient,sender_name=sender_name,subject=(title or 'Forwarding message')[:255],body=message[:10000],message=message[:10000]); db.session.add(msg)
        db.session.commit()
        result = {'success': True, 'message': msg.to_dict() if msg else None, 'document': doc.to_dict() if doc else None}
        if stamp_unavailable:
            result['warning'] = 'The document was forwarded, but this server could not add the signed-by stamp because PDF signing support is unavailable.'
        return jsonify(**result),201
    except ValueError as exc:
        db.session.rollback()
        if temporary_source:
            try: os.remove(temporary_source)
            except OSError: pass
        if path:
            try: os.remove(path)
            except OSError: pass
        return json_error(str(exc))
    except Exception:
        db.session.rollback()
        if temporary_source:
            try: os.remove(temporary_source)
            except OSError: pass
        if path:
            try: os.remove(path)
            except OSError: pass
        current_app.logger.exception('Department communication send failed'); return json_error('Could not send this conversation item.',500)


@communication_bp.post('/forward')
@require_roles(ROLES)
def create_forward():
    """Save one forwarding conversation item, with zero, one, or two PDF attachments."""
    dept=active_department(); recipient=str(request.form.get('recipient_department') or '').strip().lower()
    message=str(request.form.get('message') or '').strip(); title=str(request.form.get('title') or '').strip() or 'Forwarded document'
    local_file=request.files.get('file'); secret_id=str(request.form.get('secretariate_document_id') or '').strip(); procurement_id=str(request.form.get('procurement_document_id') or '').strip(); accounts_id=str(request.form.get('accounts_dispensing_document_id') or '').strip(); forwarded_id=str(request.form.get('forwarded_document_id') or '').strip(); forwarded_forward_id=str(request.form.get('forwarded_forward_id') or '').strip()
    if not dept or recipient not in DEPARTMENTS or recipient==dept: return json_error('Choose another valid destination department.')
    if not message and not (local_file and local_file.filename) and not (secret_id or procurement_id or accounts_id or forwarded_id or forwarded_forward_id): return json_error('Write a message or attach a file.')
    user=session_user(); sender_name=str(user.get('username') or 'Staff'); sender_user_id=user.get('id')
    if not sender_user_id: return json_error('Your session does not include a user ID. Please sign in again.',401)
    forward_id=str(uuid.uuid4()); documents=[]; created_paths=[]; stamp=True; stamp_unavailable=False
    def store_pdf(source, original, document_content='', document_title=None):
        nonlocal stamp_unavailable
        path, pdf_name=convert_to_pdf(source, original, title, document_content)
        if stamp and stamp_file(path, '.pdf', sender_name, forwarding_role_title()) is False: stamp_unavailable=True
        created_paths.append(path)
        row=DepartmentSharedDocument(sender_department=dept,recipient_department=recipient,title=(document_title or title)[:240],original_filename=pdf_name[:255],stored_filename=os.path.basename(path),mime_type='application/pdf',uploaded_by=sender_name,forward_id=forward_id)
        db.session.add(row); documents.append(row)
    try:
        # A selected store document and a local file are intentionally handled
        # independently, allowing both to travel in the same forwarding item.
        if forwarded_forward_id:
            original_forward = DepartmentMessage.query.filter_by(forward_id=forwarded_forward_id).first()
            if not original_forward or dept not in (original_forward.sender_department, original_forward.recipient_department):
                return json_error('You cannot forward this forwarding item.')
            original_docs = DepartmentSharedDocument.query.filter_by(forward_id=forwarded_forward_id).order_by(DepartmentSharedDocument.created_at.asc()).all()
            if not original_docs:
                return json_error('The selected forwarding item has no attachments.')
            for stored in original_docs:
                source = os.path.join(upload_folder(), stored.stored_filename)
                if not os.path.isfile(source): return json_error('One of the selected forwarding attachments could not be found.')
                # Re-forwarding deliberately overlays a new stamp when the
                # sender requests it; the previous stamp remains in place.
                store_pdf(source, stored.original_filename, document_title=stored.title)
        elif secret_id or procurement_id or accounts_id or forwarded_id:
            if forwarded_id:
                model, selected = DepartmentSharedDocument, forwarded_id
            elif accounts_id:
                if dept!='accounts': return json_error('Only Finance can attach a Finance dispensing document.')
                model, selected = AccountsDispensingDocument, accounts_id
            elif procurement_id:
                model, selected = ProcurementDocument, procurement_id
            else:
                model, selected = SecretariateDocument, secret_id
            try: stored=db.session.get(model,int(selected))
            except (TypeError,ValueError): stored=None
            if not stored: return json_error('The selected store document was not found.')
            if forwarded_id and dept not in (stored.sender_department, stored.recipient_department): return json_error('You cannot forward this sent file.')
            if model is ProcurementDocument:
                if stored.is_scanned_document and stored.scan_data:
                    source, original = _procurement_document_source(stored)
                    try:
                        store_pdf(source, original, _procurement_document_text(stored), document_title=(stored.document_type_display or stored.title))
                    finally:
                        try: os.remove(source)
                        except OSError: pass
                else:
                    generated = os.path.join(upload_folder(), uuid.uuid4().hex + '.pdf')
                    try:
                        _create_procurement_pdf(generated, stored)
                        original = (secure_filename(stored.document_type_display or stored.title or 'Procurement Document') or 'Procurement-Document') + '.pdf'
                        store_pdf(generated, original, document_title=(stored.document_type_display or stored.title))
                    finally:
                        try: os.remove(generated)
                        except OSError: pass
            elif model is AccountsDispensingDocument:
                generated = os.path.join(upload_folder(), uuid.uuid4().hex + '.pdf')
                try:
                    _create_accounts_dispensing_pdf(
                        generated, stored.reference, stored.recipient, stored.amount, stored.purpose,
                        stored.payment_method, stored.approved_by, stored.notes, stored.created_by,
                        getattr(stored, 'created_at', None),
                    )
                    store_pdf(generated, f'{stored.reference}.pdf', document_title='Funds Dispensing Voucher')
                finally:
                    try: os.remove(generated)
                    except OSError: pass
            else:
                original=secure_filename(getattr(stored,'original_filename',None) or (getattr(stored,'reference',None) or getattr(stored,'title','document')) + '.pdf')
                stored_filename=getattr(stored,'stored_filename',None)
                if stored_filename:
                    source=os.path.join(upload_folder(),stored_filename)
                    if not os.path.isfile(source): return json_error('The selected store document file could not be found.')
                    store_pdf(source,original,getattr(stored,'content','') or '', document_title=(getattr(stored, 'document_type', None) or getattr(stored, 'title', None)))
                else:
                    # Secretariat records may be text-only; render their saved content as a PDF.
                    content = _secretariate_document_text(stored) if model is SecretariateDocument else getattr(stored, 'content', '') or ''
                    if not content: return json_error('The selected store document has no file or saved content to forward.')
                    generated=os.path.join(upload_folder(),uuid.uuid4().hex+'.pdf')
                    try:
                        _create_secretariate_pdf(generated, stored) if model is SecretariateDocument else _create_text_pdf(generated, getattr(stored, 'title', '') or title, content)
                        store_pdf(generated,(os.path.splitext(original)[0] or 'document')+'.pdf', document_title=(getattr(stored, 'document_type', None) or getattr(stored, 'title', None)))
                    finally:
                        try: os.remove(generated)
                        except OSError: pass
        if local_file and local_file.filename:
            original=secure_filename(local_file.filename) or 'attachment'
            ext=os.path.splitext(original)[1].lower(); temporary=os.path.join(upload_folder(),uuid.uuid4().hex+ext)
            local_file.save(temporary)
            try: store_pdf(temporary,original)
            finally:
                try: os.remove(temporary)
                except OSError: pass
        record=DepartmentMessage(sender_user_id=int(sender_user_id),sender_department=dept,recipient_department=recipient,sender_name=sender_name,subject=title[:255],body=message[:10000],message=message[:10000],forward_id=forward_id)
        db.session.add(record); db.session.commit()
        result={'success':True,'forward_id':forward_id,'message':record.to_dict(),'documents':[doc.to_dict() for doc in documents]}
        if stamp_unavailable: result['warning']='Forwarded successfully, but the signed-by stamp could not be added because PDF signing support is unavailable.'
        return jsonify(**result),201
    except ValueError as exc:
        db.session.rollback(); [os.remove(path) for path in created_paths if os.path.exists(path)]; return json_error(str(exc))
    except Exception:
        db.session.rollback(); [os.remove(path) for path in created_paths if os.path.exists(path)]; current_app.logger.exception('Forwarding creation failed'); return json_error('Could not forward the item.',500)

@communication_bp.delete('/messages/<int:message_id>')
@require_roles(ROLES)
def delete_message(message_id):
    dept=active_department(); row=db.session.get(DepartmentMessage,message_id)
    if not row or dept not in (row.sender_department,row.recipient_department): return redirect(url_for('hms'))
    if not os.path.isfile(os.path.join(upload_folder(), row.stored_filename)): return redirect(url_for('hms'))
    db.session.delete(row); db.session.commit(); return jsonify(success=True)

@communication_bp.delete('/documents/<int:doc_id>')
@require_roles(ROLES)
def delete_document(doc_id):
    dept=active_department(); row=db.session.get(DepartmentSharedDocument,doc_id)
    if not row or dept not in (row.sender_department,row.recipient_department): return redirect(url_for('hms'))
    if not os.path.isfile(os.path.join(upload_folder(), row.stored_filename)): return redirect(url_for('hms'))
    try: os.remove(os.path.join(upload_folder(),row.stored_filename))
    except FileNotFoundError: pass
    except OSError: current_app.logger.warning('Could not remove shared document file %s',row.stored_filename)
    db.session.delete(row); db.session.commit(); return jsonify(success=True)

@communication_bp.post('/documents')
@require_roles(ROLES)
def upload_document():
    dept=active_department(); recipient=str(request.form.get('recipient_department') or '').strip().lower(); title=str(request.form.get('title') or '').strip()
    file=request.files.get('file')
    if not dept or recipient not in DEPARTMENTS or recipient==dept: return json_error('Choose another valid destination department.')
    if not title or not file or not file.filename: return json_error('Document title and file are required.')
    original=secure_filename(file.filename); ext=os.path.splitext(original)[1].lower()
    if ext not in ALLOWED_EXTENSIONS: return json_error('Unsupported file type.')
    file.stream.seek(0,os.SEEK_END); size=file.stream.tell(); file.stream.seek(0)
    if size>100*1024*1024: return json_error('Maximum file size is 100 MB.')
    stored=uuid.uuid4().hex+ext; folder=upload_folder(); path=os.path.join(folder,stored)
    try:
        file.save(path); user=session_user()
        row=DepartmentSharedDocument(sender_department=dept,recipient_department=recipient,title=title[:240],original_filename=original[:255],stored_filename=stored,mime_type=file.mimetype,uploaded_by=str(user.get('username') or 'Staff'))
        db.session.add(row); db.session.commit(); return jsonify(success=True,document=row.to_dict()),201
    except Exception:
        db.session.rollback()
        try: os.remove(path)
        except OSError: pass
        current_app.logger.exception('Shared department document upload failed'); return json_error('Could not save the document.',500)

@communication_bp.get('/documents')
@require_roles(ROLES)
def documents():
    dept=active_department()
    rows=DepartmentSharedDocument.query.filter((DepartmentSharedDocument.sender_department==dept)|(DepartmentSharedDocument.recipient_department==dept)).order_by(DepartmentSharedDocument.created_at.desc()).limit(250).all()
    return jsonify(success=True,department=dept,documents=[r.to_dict() for r in rows])

@communication_bp.get('/documents/<int:doc_id>/download')
@require_roles(ROLES)
def download_document(doc_id):
    dept=active_department(); row=db.session.get(DepartmentSharedDocument,doc_id)
    if not row or dept not in (row.sender_department,row.recipient_department): return redirect(url_for('hms'))
    if not os.path.isfile(os.path.join(upload_folder(), row.stored_filename)): return redirect(url_for('hms'))
    return send_from_directory(upload_folder(),row.stored_filename,as_attachment=True,download_name=row.original_filename)

@communication_bp.get('/documents/<int:doc_id>/view')
@require_roles(ROLES)
def view_document(doc_id):
    dept=active_department(); row=db.session.get(DepartmentSharedDocument,doc_id)
    if not row or dept not in (row.sender_department,row.recipient_department): return redirect(url_for('hms'))
    if not os.path.isfile(os.path.join(upload_folder(), row.stored_filename)): return redirect(url_for('hms'))
    return send_from_directory(upload_folder(),row.stored_filename,as_attachment=False,download_name=row.original_filename, mimetype='application/pdf')
