import pytest
from app.services.drive_naming import content_filename


def test_filename_preserves_extension_and_removes_paths():
    assert content_filename('La fotosintesi.pdf', 'upload.pdf') == 'La fotosintesi.pdf'
    assert content_filename(' Acqua / ciclo \\ naturale ', 'IMG001.PNG') == 'Acqua ciclo naturale.PNG'
    assert len(content_filename('a' * 400, 'long.docx')) == 125


def test_empty_titles_are_rejected():
    with pytest.raises(ValueError):
        content_filename(' ... ', 'file.txt')
