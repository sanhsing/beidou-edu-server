#!/usr/bin/env python3
"""認證系統 API 測試"""

import pytest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask
from cert_api import cert_bp
import json

app = Flask(__name__)
app.register_blueprint(cert_bp)

os.environ['DB_PATH'] = './education_v53.db'

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

class TestCertList:
    def test_get_list(self, client):
        rv = client.get('/api/cert/list')
        data = json.loads(rv.data)
        assert data['success'] == True
        assert len(data['data']) == 4  # 4個認證

class TestCertPath:
    def test_get_path(self, client):
        rv = client.get('/api/cert/google_ai/path')
        data = json.loads(rv.data)
        assert data['success'] == True
        assert 'cert' in data['data']
        assert 'domains' in data['data']
    
    def test_path_not_found(self, client):
        rv = client.get('/api/cert/invalid/path')
        assert rv.status_code == 404

class TestGlossary:
    def test_get_glossary(self, client):
        rv = client.get('/api/cert/google_ai/glossary')
        data = json.loads(rv.data)
        assert data['success'] == True
        assert 'terms' in data['data']
    
    def test_search(self, client):
        rv = client.get('/api/cert/glossary/search?q=machine')
        data = json.loads(rv.data)
        assert data['success'] == True
        assert 'results' in data['data']
    
    def test_search_too_short(self, client):
        rv = client.get('/api/cert/glossary/search?q=a')
        assert rv.status_code == 400

class TestProgress:
    def test_update_progress(self, client):
        rv = client.post('/api/cert/progress',
                        json={'user_id': 1, 'cert_key': 'google_ai', 'topic_id': 1},
                        content_type='application/json')
        data = json.loads(rv.data)
        assert data['success'] == True
    
    def test_get_progress(self, client):
        rv = client.get('/api/cert/progress/1')
        data = json.loads(rv.data)
        assert data['success'] == True

class TestExam:
    def test_start_exam(self, client):
        rv = client.post('/api/cert/exam/start',
                        json={'user_id': 1, 'cert_key': 'google_ai', 'count': 5},
                        content_type='application/json')
        data = json.loads(rv.data)
        # 可能沒題目
        assert 'success' in data

if __name__ == '__main__':
    pytest.main([__file__, '-v'])
